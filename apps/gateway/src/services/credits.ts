/**
 * Credits & ads service.
 *
 * Money model: a user holds a rupiah *credit balance* (earned from ads,
 * top-ups, grants). Converting that balance buys *allowance tokens*, a pool
 * that is consumed by real API usage on top of the daily free quota.
 *
 * Invariants enforced here, not in the routes:
 *   1. Every balance movement is one immutable CreditLedgerEntry row, written
 *      in a serializable transaction together with its `balanceAfter`.
 *   2. A reward is paid at most once per ad session (adSessionId is UNIQUE).
 *   3. A user can never convert more rupiah than they hold, nor more tokens
 *      than the weekly cap allows.
 *   4. Ads pay a rupiah amount drawn at *issue* time from the creative's
 *      configured range — the client can never influence the payout.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { PrismaClient, AdCreative, CreditConfig } from "@dgtlz/db";
import { GatewayError } from "@dgtlz/core";

export const DEFAULT_CONFIG = {
  tokensPerRupiah: 50,
  minConvertRupiah: 10_000,
  dailyAdsPerUser: 15,
  dailyRewardCapRupiah: 60_000,
  weeklyTokenCap: 5_000_000n,
  minWatchPercent: 85,
  sessionTtlSeconds: 300,
  adsEnabled: true,
};

export type CreditConfigView = {
  tokensPerRupiah: number;
  minConvertRupiah: number;
  dailyAdsPerUser: number;
  dailyRewardCapRupiah: number;
  weeklyTokenCap: number;
  minWatchPercent: number;
  sessionTtlSeconds: number;
  adsEnabled: boolean;
};

export function toConfigView(cfg: CreditConfig | null): CreditConfigView {
  return {
    tokensPerRupiah: cfg?.tokensPerRupiah ?? DEFAULT_CONFIG.tokensPerRupiah,
    minConvertRupiah: cfg?.minConvertRupiah ?? DEFAULT_CONFIG.minConvertRupiah,
    dailyAdsPerUser: cfg?.dailyAdsPerUser ?? DEFAULT_CONFIG.dailyAdsPerUser,
    dailyRewardCapRupiah: cfg?.dailyRewardCapRupiah ?? DEFAULT_CONFIG.dailyRewardCapRupiah,
    weeklyTokenCap: Number(cfg?.weeklyTokenCap ?? DEFAULT_CONFIG.weeklyTokenCap),
    minWatchPercent: cfg?.minWatchPercent ?? DEFAULT_CONFIG.minWatchPercent,
    sessionTtlSeconds: cfg?.sessionTtlSeconds ?? DEFAULT_CONFIG.sessionTtlSeconds,
    adsEnabled: cfg?.adsEnabled ?? DEFAULT_CONFIG.adsEnabled,
  };
}

export async function loadConfig(prisma: PrismaClient): Promise<CreditConfigView> {
  const cfg = await prisma.creditConfig.findUnique({ where: { id: "singleton" } });
  return toConfigView(cfg);
}

function startOfDay(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Balance = balanceAfter of the newest ledger row (0 when the ledger is empty). */
export async function getBalanceRupiah(prisma: PrismaClient, userId: string): Promise<number> {
  const last = await prisma.creditLedgerEntry.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

/** Allowance tokens remaining = granted - consumed. Never negative. */
export async function getAllowanceTokens(prisma: PrismaClient, userId: string): Promise<number> {
  const [granted, consumed] = await Promise.all([
    prisma.$queryRaw<{ sum: bigint | null }[]>`
      SELECT COALESCE(SUM("tokensGranted"), 0)::bigint AS sum
      FROM "CreditLedgerEntry" WHERE "userId" = ${userId} AND type = 'CONVERT'
    `,
    prisma.$queryRaw<{ sum: bigint | null }[]>`
      SELECT COALESCE(SUM("totalTokens"), 0)::bigint AS sum
      FROM "UsageRecord" WHERE "userId" = ${userId} AND "billingStatus" = 'ALLOWANCE'
    `,
  ]);
  const remaining = Number(granted[0]?.sum ?? 0n) - Number(consumed[0]?.sum ?? 0n);
  return Math.max(0, remaining);
}

export interface LedgerSummary {
  balanceRupiah: number;
  allowanceTokens: number;
  lifetimeEarnedRupiah: number;
  lifetimeConvertedRupiah: number;
  lifetimeTokensGranted: number;
  adsWatchedToday: number;
  earnedTodayRupiah: number;
  tokensConvertedThisWeek: number;
}

export async function getLedgerSummary(prisma: PrismaClient, userId: string): Promise<LedgerSummary> {
  const dayStart = startOfDay();
  const weekStart = new Date(Date.now() - 7 * 86_400_000);

  const [
    balanceRupiah,
    allowanceTokens,
    earnedAgg,
    convertedAgg,
    adsToday,
    earnedTodayAgg,
    convertedWeekAgg,
  ] = await Promise.all([
    getBalanceRupiah(prisma, userId),
    getAllowanceTokens(prisma, userId),
    prisma.creditLedgerEntry.aggregate({
      where: { userId, type: "AD_REWARD" },
      _sum: { amountRupiah: true },
    }),
    prisma.creditLedgerEntry.aggregate({
      where: { userId, type: { in: ["CONVERT", "REFUND"] } },
      _sum: { amountRupiah: true },
    }),
    prisma.adSession.count({ where: { userId, status: "COMPLETED", completedAt: { gte: dayStart } } }),
    prisma.creditLedgerEntry.aggregate({
      where: { userId, type: "AD_REWARD", createdAt: { gte: dayStart } },
      _sum: { amountRupiah: true },
    }),
    prisma.creditLedgerEntry.aggregate({
      where: { userId, type: "CONVERT", createdAt: { gte: weekStart } },
      _sum: { tokensGranted: true },
    }),
  ]);

  return {
    balanceRupiah,
    allowanceTokens,
    lifetimeEarnedRupiah: earnedAgg._sum.amountRupiah ?? 0,
    // CONVERT amounts are negative, so flip the sign for display.
    lifetimeConvertedRupiah: Math.abs(convertedAgg._sum.amountRupiah ?? 0),
    lifetimeTokensGranted: Number(convertedAgg._sum.tokensGranted ?? 0n),
    adsWatchedToday: adsToday,
    earnedTodayRupiah: earnedTodayAgg._sum.amountRupiah ?? 0,
    tokensConvertedThisWeek: Number(convertedWeekAgg._sum.tokensGranted ?? 0n),
  };
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

/** Picks a creative the user has not seen most recently, round-robin-ish. */
export async function pickCreative(prisma: PrismaClient, userId: string): Promise<AdCreative> {
  const creatives = await prisma.adCreative.findMany({
    where: { active: true },
    orderBy: { slug: "asc" },
  });
  if (!creatives.length) throw new GatewayError("not_found", 503, "no ad creatives configured");

  const recent = await prisma.adSession.findMany({
    where: { userId },
    orderBy: { issuedAt: "desc" },
    take: Math.min(creatives.length, 6),
    select: { creativeId: true },
  });
  const recentIds = new Set(recent.map((r) => r.creativeId));
  const fresh = creatives.filter((c) => !recentIds.has(c.id));
  const pool = fresh.length ? fresh : creatives;
  return pool[randomInt(pool.length)];
}

export function signNonce(secret: string, id: string, userId: string, issuedAt: Date): string {
  return createHmac("sha256", secret)
    .update(`${id}|${userId}|${issuedAt.toISOString()}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface IssueResult {
  sessionId: string;
  nonce: string;
  creative: {
    id: string;
    slug: string;
    title: string;
    brand: string;
    tagline: string | null;
    videoUrl: string;
    posterUrl: string | null;
    accent: string;
    durationMs: number;
  };
  rewardRupiah: number;
  expiresAt: string;
  /** How long the browser must actually play the clip. */
  requiredWatchMs: number;
}

export async function issueAdSession(
  prisma: PrismaClient,
  opts: { userId: string; secret: string; ip?: string; userAgent?: string },
): Promise<IssueResult> {
  const cfg = await loadConfig(prisma);
  if (!cfg.adsEnabled) throw new GatewayError("invalid_request", 503, "ads are temporarily disabled");

  const dayStart = startOfDay();
  const [watchedToday, earnedTodayAgg] = await Promise.all([
    prisma.adSession.count({ where: { userId: opts.userId, status: "COMPLETED", completedAt: { gte: dayStart } } }),
    prisma.creditLedgerEntry.aggregate({
      where: { userId: opts.userId, type: "AD_REWARD", createdAt: { gte: dayStart } },
      _sum: { amountRupiah: true },
    }),
  ]);

  if (watchedToday >= cfg.dailyAdsPerUser) {
    throw new GatewayError("quota_exceeded", 429, `daily ad limit reached (${cfg.dailyAdsPerUser} ads)`);
  }
  const earnedToday = earnedTodayAgg._sum.amountRupiah ?? 0;
  if (earnedToday >= cfg.dailyRewardCapRupiah) {
    throw new GatewayError("quota_exceeded", 429, `daily ad reward cap reached (Rp ${cfg.dailyRewardCapRupiah})`);
  }

  const creative = await pickCreative(prisma, opts.userId);
  const id = cryptoRandomId();
  const issuedAt = new Date();
  const nonce = signNonce(opts.secret, id, opts.userId, issuedAt);
  const expiresAt = new Date(issuedAt.getTime() + cfg.sessionTtlSeconds * 1000);

  // Draw the reward now so the payout is decided server-side, before playback.
  const min = Math.max(0, creative.rewardMinRupiah);
  const max = Math.max(min, creative.rewardMaxRupiah);
  const rewardRupiah = randomInt(min, max + 1);

  await prisma.adSession.create({
    data: {
      id,
      userId: opts.userId,
      creativeId: creative.id,
      nonce,
      rewardRupiah,
      durationMs: creative.durationMs,
      ip: opts.ip?.slice(0, 64) ?? null,
      userAgent: opts.userAgent?.slice(0, 255) ?? null,
      expiresAt,
    },
  });

  return {
    sessionId: id,
    nonce,
    creative: {
      id: creative.id,
      slug: creative.slug,
      title: creative.title,
      brand: creative.brand,
      tagline: creative.tagline,
      videoUrl: creative.videoUrl,
      posterUrl: creative.posterUrl,
      accent: creative.accent,
      durationMs: creative.durationMs,
    },
    rewardRupiah,
    expiresAt: expiresAt.toISOString(),
    requiredWatchMs: Math.round((creative.durationMs * cfg.minWatchPercent) / 100),
  };
}

function cryptoRandomId(): string {
  return randomBytesId();
}

import { randomUUID } from "node:crypto";
function randomBytesId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

export interface CompleteResult {
  rewarded: boolean;
  rewardRupiah: number;
  balanceRupiah: number;
  allowanceTokens: number;
  reason?: string;
}

export async function completeAdSession(
  prisma: PrismaClient,
  opts: {
    userId: string;
    sessionId: string;
    nonce: string;
    watchedMs: number;
    interruptions: number;
  },
): Promise<CompleteResult> {
  const cfg = await loadConfig(prisma);
  const session = await prisma.adSession.findUnique({ where: { id: opts.sessionId } });
  if (!session) throw new GatewayError("not_found", 404, "ad session not found");
  if (session.userId !== opts.userId) throw new GatewayError("not_found", 404, "ad session not found");
  if (!safeEqual(session.nonce, opts.nonce)) {
    throw new GatewayError("invalid_request", 400, "ad session nonce does not match");
  }

  // Idempotent: a finished session just reports its result again.
  if (session.status === "COMPLETED") {
    const [balanceRupiah, allowanceTokens] = await Promise.all([
      getBalanceRupiah(prisma, opts.userId),
      getAllowanceTokens(prisma, opts.userId),
    ]);
    return { rewarded: true, rewardRupiah: session.rewardRupiah, balanceRupiah, allowanceTokens };
  }
  if (session.status !== "ISSUED") {
    throw new GatewayError("invalid_request", 409, `ad session already ${session.status.toLowerCase()}`);
  }
  if (session.expiresAt < new Date()) {
    await prisma.adSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } });
    throw new GatewayError("invalid_request", 410, "ad session expired, start a new one");
  }

  const required = Math.round((session.durationMs * cfg.minWatchPercent) / 100);
  const watched = Math.min(Math.max(0, Math.round(opts.watchedMs)), session.durationMs);
  if (watched < required) {
    await prisma.adSession.update({
      where: { id: session.id },
      data: { status: "REJECTED", watchedMs: watched, interruptions: opts.interruptions },
    });
    return {
      rewarded: false,
      rewardRupiah: 0,
      balanceRupiah: await getBalanceRupiah(prisma, opts.userId),
      allowanceTokens: await getAllowanceTokens(prisma, opts.userId),
      reason: `watched ${watched}ms of ${session.durationMs}ms, need ${required}ms`,
    };
  }

  // Caps are re-checked here: issuing and completing can be minutes apart.
  const dayStart = startOfDay();
  const [watchedToday, earnedTodayAgg] = await Promise.all([
    prisma.adSession.count({
      where: { userId: opts.userId, status: "COMPLETED", completedAt: { gte: dayStart } },
    }),
    prisma.creditLedgerEntry.aggregate({
      where: { userId: opts.userId, type: "AD_REWARD", createdAt: { gte: dayStart } },
      _sum: { amountRupiah: true },
    }),
  ]);
  if (watchedToday >= cfg.dailyAdsPerUser) {
    await prisma.adSession.update({ where: { id: session.id }, data: { status: "REJECTED", watchedMs: watched } });
    throw new GatewayError("quota_exceeded", 429, `daily ad limit reached (${cfg.dailyAdsPerUser} ads)`);
  }
  const earnedToday = earnedTodayAgg._sum.amountRupiah ?? 0;
  if (earnedToday >= cfg.dailyRewardCapRupiah) {
    await prisma.adSession.update({ where: { id: session.id }, data: { status: "REJECTED", watchedMs: watched } });
    throw new GatewayError("quota_exceeded", 429, `daily ad reward cap reached (Rp ${cfg.dailyRewardCapRupiah})`);
  }

  const balanceRupiah = await prisma.$transaction(async (tx) => {
    const last = await tx.creditLedgerEntry.findFirst({
      where: { userId: opts.userId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const next = (last?.balanceAfter ?? 0) + session.rewardRupiah;

    await tx.adSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        watchedMs: watched,
        interruptions: Math.min(Math.max(0, opts.interruptions), 100),
        completedAt: new Date(),
      },
    });
    await tx.creditLedgerEntry.create({
      data: {
        userId: opts.userId,
        type: "AD_REWARD",
        source: "HOUSE",
        amountRupiah: session.rewardRupiah,
        balanceAfter: next,
        adSessionId: session.id,
        actorId: "system",
        note: `ad ${session.creativeId}`,
      },
    });
    return next;
  }, { isolationLevel: "Serializable" });

  return {
    rewarded: true,
    rewardRupiah: session.rewardRupiah,
    balanceRupiah,
    allowanceTokens: await getAllowanceTokens(prisma, opts.userId),
  };
}

// ---------------------------------------------------------------------------
// Conversion & balance movements
// ---------------------------------------------------------------------------

export interface ConvertResult {
  convertedRupiah: number;
  tokensGranted: number;
  balanceRupiah: number;
  allowanceTokens: number;
  balanceAfter: number;
}

export async function convertToTokens(
  prisma: PrismaClient,
  opts: { userId: string; rupiah?: number },
): Promise<ConvertResult> {
  const cfg = await loadConfig(prisma);

  return prisma.$transaction(async (tx) => {
    const last = await tx.creditLedgerEntry.findFirst({
      where: { userId: opts.userId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const balance = last?.balanceAfter ?? 0;
    if (balance < cfg.minConvertRupiah) {
      throw new GatewayError(
        "invalid_request",
        400,
        `minimum conversion is Rp ${cfg.minConvertRupiah.toLocaleString("id-ID")} (you have Rp ${balance.toLocaleString("id-ID")})`,
      );
    }

    // Default: convert the whole balance, but never below the minimum.
    const requested = opts.rupiah && opts.rupiah > 0 ? Math.floor(opts.rupiah) : balance;
    const spend = Math.min(requested, balance);
    if (spend < cfg.minConvertRupiah) {
      throw new GatewayError("invalid_request", 400, `minimum conversion is Rp ${cfg.minConvertRupiah}`);
    }

    const weekStart = new Date(Date.now() - 7 * 86_400_000);
    const weekAgg = await tx.creditLedgerEntry.aggregate({
      where: { userId: opts.userId, type: "CONVERT", createdAt: { gte: weekStart } },
      _sum: { tokensGranted: true },
    });
    const alreadyThisWeek = Number(weekAgg._sum.tokensGranted ?? 0n);
    const tokensGranted = spend * cfg.tokensPerRupiah;
    if (alreadyThisWeek + tokensGranted > Number(cfg.weeklyTokenCap)) {
      const left = Math.max(0, Number(cfg.weeklyTokenCap) - alreadyThisWeek);
      throw new GatewayError(
        "quota_exceeded",
        429,
        `weekly conversion cap reached (${cfg.weeklyTokenCap.toLocaleString("id-ID")} tokens, ${left.toLocaleString("id-ID")} left)`,
      );
    }

    const next = balance - spend;
    await tx.creditLedgerEntry.create({
      data: {
        userId: opts.userId,
        type: "CONVERT",
        source: "HOUSE",
        amountRupiah: -spend,
        balanceAfter: next,
        tokensGranted: BigInt(tokensGranted),
        actorId: opts.userId,
        note: `Rp ${spend} -> ${tokensGranted} allowance tokens`,
      },
    });

    return {
      convertedRupiah: spend,
      tokensGranted,
      balanceRupiah: next,
      allowanceTokens: await getAllowanceTokens(tx as unknown as PrismaClient, opts.userId),
      balanceAfter: next,
    };
  }, { isolationLevel: "Serializable" });
}

/** Operator/system credit movement. Positive credits, negative debits. */
export async function adjustBalance(
  prisma: PrismaClient,
  opts: {
    userId: string;
    amountRupiah: number;
    type: "TOPUP" | "GRANT" | "ADJUSTMENT" | "REFUND";
    source?: "OPERATOR" | "PAYMENT" | "HOUSE" | "SPONSOR";
    note?: string;
    actorId?: string;
  },
): Promise<{ balanceRupiah: number }> {
  if (!Number.isFinite(opts.amountRupiah) || opts.amountRupiah === 0) {
    throw new GatewayError("invalid_request", 400, "amountRupiah must be a non-zero integer");
  }
  const amount = Math.trunc(opts.amountRupiah);

  return prisma.$transaction(async (tx) => {
    const last = await tx.creditLedgerEntry.findFirst({
      where: { userId: opts.userId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const current = last?.balanceAfter ?? 0;
    const next = current + amount;
    if (next < 0) {
      throw new GatewayError("invalid_request", 400, `balance cannot go negative (holds Rp ${current})`);
    }
    await tx.creditLedgerEntry.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        source: opts.source ?? "OPERATOR",
        amountRupiah: amount,
        balanceAfter: next,
        note: opts.note?.slice(0, 200) ?? null,
        actorId: opts.actorId ?? "operator",
      },
    });
    return { balanceRupiah: next };
  }, { isolationLevel: "Serializable" });
}

export async function listLedger(
  prisma: PrismaClient,
  userId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    type: string;
    source: string;
    amountRupiah: number;
    balanceAfter: number;
    tokensGranted: number | null;
    note: string | null;
    createdAt: string;
  }>
> {
  const rows = await prisma.creditLedgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 200),
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    source: r.source,
    amountRupiah: r.amountRupiah,
    balanceAfter: r.balanceAfter,
    tokensGranted: r.tokensGranted === null ? null : Number(r.tokensGranted),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}
