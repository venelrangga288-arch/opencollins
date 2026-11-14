/**
 * Credits & "watch ads to earn" API — /api/v1/credits
 *
 * Design notes:
 *   - Rewards are decided server-side at issue time and stored on the session,
 *     so the client can never name its own payout.
 *   - Completing a session is idempotent and capped (daily ads + daily rupiah).
 *   - Conversion moves rupiah balance into allowance tokens; the usage worker
 *     spends allowance first, which is what makes earned balance usable.
 *   - Everything is dashboard-session only. API keys cannot farm ads.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";
import { requireSessionUser } from "../lib/auth.js";
import { readQuotaState } from "../lib/quota.js";
import {
  completeAdSession,
  convertToTokens,
  getLedgerSummary,
  issueAdSession,
  listLedger,
  loadConfig,
} from "../services/credits.js";

const CompleteSchema = z.object({
  sessionId: z.string().min(1).max(64),
  nonce: z.string().min(1).max(128),
  watchedMs: z.number().int().min(0).max(600_000),
  interruptions: z.number().int().min(0).max(1000).optional(),
});

const ConvertSchema = z.object({
  rupiah: z.number().int().positive().max(10_000_000).optional(),
});

export const creditRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma } = opts.deps;
  const auth = (req: Parameters<typeof requireSessionUser>[0]) => requireSessionUser(req, opts.deps);

  /** Balance, allowance, caps and the live config — one call for the dashboard. */
  app.get("/", async (req) => {
    const { userId } = await auth(req);
    const [config, summary, quota] = await Promise.all([
      loadConfig(prisma),
      getLedgerSummary(prisma, userId),
      readQuotaState(opts.deps, userId),
    ]);
    return {
      config,
      balance: {
        rupiah: summary.balanceRupiah,
        allowanceTokens: summary.allowanceTokens,
      },
      earnings: {
        lifetimeRupiah: summary.lifetimeEarnedRupiah,
        lifetimeTokensGranted: summary.lifetimeTokensGranted,
        convertedRupiah: summary.lifetimeConvertedRupiah,
      },
      today: {
        adsWatched: summary.adsWatchedToday,
        adsLimit: config.dailyAdsPerUser,
        earnedRupiah: summary.earnedTodayRupiah,
        earnLimitRupiah: config.dailyRewardCapRupiah,
      },
      week: {
        tokensConverted: summary.tokensConvertedThisWeek,
        tokenCap: config.weeklyTokenCap,
      },
      quota,
    };
  });

  app.get("/ledger", async (req) => {
    const { userId } = await auth(req);
    const limit = Number((req.query as { limit?: string })?.limit ?? 50);
    return { entries: await listLedger(prisma, userId, Number.isFinite(limit) ? limit : 50) };
  });

  /** Daily earned / converted series for the earnings chart. */
  app.get("/series", async (req) => {
    const { userId } = await auth(req);
    const raw = Number((req.query as { days?: string })?.days ?? 7);
    const days = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), 90) : 7;

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const rows = await prisma.creditLedgerEntry.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { type: true, amountRupiah: true, tokensGranted: true, createdAt: true },
    });

    const buckets = new Map<string, { earnedRupiah: number; convertedRupiah: number; tokensGranted: number; ads: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      buckets.set(d.toISOString().slice(0, 10), {
        earnedRupiah: 0,
        convertedRupiah: 0,
        tokensGranted: 0,
        ads: 0,
      });
    }
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      if (row.type === "AD_REWARD") {
        b.earnedRupiah += row.amountRupiah;
        b.ads += 1;
      } else if (row.type === "CONVERT" || row.type === "REFUND") {
        b.convertedRupiah += Math.abs(row.amountRupiah);
        b.tokensGranted += Number(row.tokensGranted ?? 0n);
      }
    }

    const points = [...buckets.entries()].map(([day, v]) => ({ day, ...v }));
    const totals = points.reduce(
      (acc, p) => ({
        earnedRupiah: acc.earnedRupiah + p.earnedRupiah,
        convertedRupiah: acc.convertedRupiah + p.convertedRupiah,
        tokensGranted: acc.tokensGranted + p.tokensGranted,
        ads: acc.ads + p.ads,
      }),
      { earnedRupiah: 0, convertedRupiah: 0, tokensGranted: 0, ads: 0 },
    );

    return { days, points, totals };
  });

  /** Issues one ad slot: creative, randomised reward, nonce, deadline. */
  app.post("/ads/session", async (req) => {
    const { userId } = await auth(req);
    return issueAdSession(prisma, {
      userId,
      secret: opts.deps.apiKeyHashSecret,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  });

  /** Reports the clip finished. The server decides whether it actually did. */
  app.post("/ads/complete", async (req) => {
    const { userId } = await auth(req);
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    }
    return completeAdSession(prisma, {
      userId,
      sessionId: parsed.data.sessionId,
      nonce: parsed.data.nonce,
      watchedMs: parsed.data.watchedMs,
      interruptions: parsed.data.interruptions ?? 0,
    });
  });

  /** Rupiah balance -> allowance tokens. */
  app.post("/convert", async (req) => {
    const { userId } = await auth(req);
    const parsed = ConvertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    }
    const result = await convertToTokens(prisma, { userId, rupiah: parsed.data.rupiah });
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "credits.convert",
        target: `user:${userId}`,
        metadata: {
          convertedRupiah: result.convertedRupiah,
          tokensGranted: result.tokensGranted,
        },
      },
    });
    return result;
  });

  /** Public catalogue so the workstation can preload posters. */
  app.get("/ads/catalog", async (req) => {
    await auth(req);
    const creatives = await prisma.adCreative.findMany({
      where: { active: true },
      orderBy: { slug: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        brand: true,
        tagline: true,
        posterUrl: true,
        accent: true,
        durationMs: true,
      },
    });
    return { creatives };
  });
};
