/**
 * Unit tests for the credits service â€” the money path.
 *
 * These run against an in-memory Prisma double so they are fast and do not
 * need Postgres. The double implements only what credits.ts touches, with the
 * ledger semantics that actually matter: newest row wins for "balance".
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  adjustBalance,
  completeAdSession,
  convertToTokens,
  getAllowanceTokens,
  getBalanceRupiah,
  listLedger,
  signNonce,
  toConfigView,
  DEFAULT_CONFIG,
} from "../src/services/credits.js";

type Row = Record<string, any>;

function makeFakePrisma(seed: { config?: Row; creatives?: Row[] } = {}) {
  const ledger: Row[] = [];
  const sessions: Row[] = [];
  const usage: Row[] = [];
  const config: Row = {
    id: "singleton",
    tokensPerRupiah: 50,
    minConvertRupiah: 10_000,
    dailyAdsPerUser: 15,
    dailyRewardCapRupiah: 60_000,
    weeklyTokenCap: 5_000_000n,
    minWatchPercent: 85,
    sessionTtlSeconds: 300,
    adsEnabled: true,
    ...(seed.config ?? {}),
  };
  const creatives: Row[] = seed.creatives ?? [
    {
      id: "c1",
      slug: "clip-01",
      title: "Ship Faster",
      brand: "dgtlz",
      tagline: "One endpoint.",
      videoUrl: "/ads/clip-01.mp4",
      posterUrl: "/ads/clip-01.jpg",
      accent: "#67dcf2",
      durationMs: 7000,
      rewardMinRupiah: 700,
      rewardMaxRupiah: 5000,
      active: true,
    },
  ];

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("gte" in v) return new Date(row[k]) >= new Date(v.gte as Date);
        if ("in" in v) return (v.in as unknown[]).includes(row[k]);
        return true;
      }
      return row[k] === v;
    });

  const prisma = {
    creditConfig: {
      findUnique: async ({ where }: any) => (where.id === config.id ? config : null),
    },
    creditLedgerEntry: {
      findFirst: async ({ where, orderBy }: any) => {
        const rows = ledger.filter((r) => matches(r, where));
        rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        void orderBy;
        return rows[0] ?? null;
      },
      findMany: async ({ where, take }: any) => {
        const rows = ledger.filter((r) => matches(r, where));
        rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        return rows.slice(0, take ?? rows.length);
      },
      create: async ({ data }: any) => {
        // Monotonic clock: two inserts in the same millisecond must still order.
        const row = {
          id: `l${ledger.length + 1}`,
          createdAt: new Date(Date.now() + ledger.length),
          ...data,
        };
        ledger.push(row);
        return row;
      },
      aggregate: async ({ where, _sum }: any) => {
        const rows = ledger.filter((r) => matches(r, where));
        const out: Row = {};
        for (const key of Object.keys(_sum ?? {})) {
          out[key] = rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
        }
        return { _sum: out, _count: rows.length };
      },
      groupBy: async ({ where, by }: any) => {
        const rows = ledger.filter((r) => matches(r, where));
        const key = by[0];
        const map = new Map<string, number>();
        for (const r of rows) map.set(r[key], (map.get(r[key]) ?? 0) + 1);
        return [...map.entries()].map(([k, n]) => ({ [key]: k, _count: n }));
      },
    },
    adCreative: {
      findMany: async () => creatives,
      findUnique: async ({ where }: any) => creatives.find((c) => c.slug === where.slug || c.id === where.id) ?? null,
    },
    adSession: {
      create: async ({ data }: any) => {
        // Mirror the schema defaults Postgres would apply.
        const row = {
          status: "ISSUED",
          interruptions: 0,
          watchedMs: 0,
          completedAt: null,
          issuedAt: new Date(),
          ...data,
        };
        sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null,
      findMany: async ({ where }: any) => sessions.filter((s) => matches(s, where)),
      count: async ({ where }: any) => sessions.filter((s) => matches(s, where)).length,
      update: async ({ where, data }: any) => {
        const row = sessions.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      groupBy: async () => [],
    },
    usageRecord: {
      aggregate: async () => ({ _sum: { totalTokens: 0 } }),
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("tokensGranted")) {
        const sum = ledger
          .filter((r) => r.type === "CONVERT")
          .reduce((acc, r) => acc + Number(r.tokensGranted ?? 0), 0);
        return [{ sum: BigInt(sum) }];
      }
      const sum = usage.reduce((acc, r) => acc + Number(r.totalTokens ?? 0), 0);
      return [{ sum: BigInt(sum) }];
    },
    $transaction: async (fn: any) => fn(prisma),
  };

  return { prisma: prisma as any, ledger, sessions, creatives, config, usage };
}

describe("credit config", () => {
  it("falls back to defaults when no row exists", () => {
    const view = toConfigView(null);
    expect(view.tokensPerRupiah).toBe(DEFAULT_CONFIG.tokensPerRupiah);
    expect(view.adsEnabled).toBe(true);
    expect(view.weeklyTokenCap).toBe(5_000_000);
  });

  it("exposes bigint caps as numbers", () => {
    const view = toConfigView({ weeklyTokenCap: 7_000_000n } as any);
    expect(typeof view.weeklyTokenCap).toBe("number");
    expect(view.weeklyTokenCap).toBe(7_000_000);
  });
});

describe("ad sessions", () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it("binds the nonce to the session and user", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const a = signNonce("secret", "sess1", "user1", issuedAt);
    const b = signNonce("secret", "sess1", "user2", issuedAt);
    expect(a).not.toBe(b);
    expect(signNonce("secret", "sess1", "user1", issuedAt)).toBe(a);
  });

  it("rejects a completion whose nonce does not match", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const issued = await issueAdSession(fake.prisma, { userId: "u1", secret: "s" });
    await expect(
      completeAdSession(fake.prisma, {
        userId: "u1",
        sessionId: issued.sessionId,
        nonce: "forged",
        watchedMs: 7000,
        interruptions: 0,
      }),
    ).rejects.toThrow(/nonce does not match/);
  });

  it("refuses to pay a session owned by another user", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const issued = await issueAdSession(fake.prisma, { userId: "u1", secret: "s" });
    await expect(
      completeAdSession(fake.prisma, {
        userId: "u2",
        sessionId: issued.sessionId,
        nonce: issued.nonce,
        watchedMs: 7000,
        interruptions: 0,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("does not pay when the clip was skipped", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const issued = await issueAdSession(fake.prisma, { userId: "u1", secret: "s" });
    const result = await completeAdSession(fake.prisma, {
      userId: "u1",
      sessionId: issued.sessionId,
      nonce: issued.nonce,
      watchedMs: 500,
      interruptions: 0,
    });
    expect(result.rewarded).toBe(false);
    expect(result.rewardRupiah).toBe(0);
    expect(fake.ledger).toHaveLength(0);
  });

  it("pays exactly once for a full watch", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const issued = await issueAdSession(fake.prisma, { userId: "u1", secret: "s" });
    const first = await completeAdSession(fake.prisma, {
      userId: "u1",
      sessionId: issued.sessionId,
      nonce: issued.nonce,
      watchedMs: 7000,
      interruptions: 0,
    });
    expect(first.rewarded).toBe(true);
    expect(first.rewardRupiah).toBe(issued.rewardRupiah);
    expect(fake.ledger).toHaveLength(1);

    const second = await completeAdSession(fake.prisma, {
      userId: "u1",
      sessionId: issued.sessionId,
      nonce: issued.nonce,
      watchedMs: 7000,
      interruptions: 0,
    });
    expect(second.balanceRupiah).toBe(first.balanceRupiah);
    expect(fake.ledger).toHaveLength(1);
  });

  it("keeps the reward inside the creative's configured range", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    for (let i = 0; i < 40; i++) {
      const issued = await issueAdSession(fake.prisma, { userId: "u1", secret: "s" });
      expect(issued.rewardRupiah).toBeGreaterThanOrEqual(700);
      expect(issued.rewardRupiah).toBeLessThanOrEqual(5000);
    }
  });

  it("stops issuing once the daily ad limit is hit", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const limited = makeFakePrisma({ config: { dailyAdsPerUser: 1 } });
    const issued = await issueAdSession(limited.prisma, { userId: "u1", secret: "s" });
    await completeAdSession(limited.prisma, {
      userId: "u1",
      sessionId: issued.sessionId,
      nonce: issued.nonce,
      watchedMs: 7000,
      interruptions: 0,
    });
    await expect(issueAdSession(limited.prisma, { userId: "u1", secret: "s" })).rejects.toThrow(
      /daily ad limit/,
    );
  });

  it("refuses to issue while ads are disabled", async () => {
    const { issueAdSession } = await import("../src/services/credits.js");
    const off = makeFakePrisma({ config: { adsEnabled: false } });
    await expect(issueAdSession(off.prisma, { userId: "u1", secret: "s" })).rejects.toThrow(
      /temporarily disabled/,
    );
  });
});

describe("balance", () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it("is zero for an empty ledger", async () => {
    expect(await getBalanceRupiah(fake.prisma, "u1")).toBe(0);
  });

  it("accumulates grants and reads the newest row", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 5000, type: "GRANT" });
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 7500, type: "TOPUP", source: "PAYMENT" });
    expect(await getBalanceRupiah(fake.prisma, "u1")).toBe(12_500);
  });

  it("refuses a debit that would go negative", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 1000, type: "GRANT" });
    await expect(
      adjustBalance(fake.prisma, { userId: "u1", amountRupiah: -5000, type: "ADJUSTMENT" }),
    ).rejects.toThrow(/cannot go negative/);
  });

  it("rejects a zero amount", async () => {
    await expect(
      adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 0, type: "GRANT" }),
    ).rejects.toThrow(/non-zero/);
  });
});

describe("conversion", () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it("refuses when the balance is below the minimum", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 9999, type: "GRANT" });
    await expect(convertToTokens(fake.prisma, { userId: "u1" })).rejects.toThrow(/minimum conversion/);
  });

  it("converts the whole balance at the configured rate", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 12_000, type: "GRANT" });
    const result = await convertToTokens(fake.prisma, { userId: "u1" });
    expect(result.convertedRupiah).toBe(12_000);
    expect(result.tokensGranted).toBe(12_000 * 50);
    expect(result.balanceRupiah).toBe(0);
    expect(await getAllowanceTokens(fake.prisma, "u1")).toBe(600_000);
  });

  it("converts a partial amount and keeps the remainder", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 20_000, type: "GRANT" });
    const result = await convertToTokens(fake.prisma, { userId: "u1", rupiah: 15_000 });
    expect(result.convertedRupiah).toBe(15_000);
    expect(result.balanceRupiah).toBe(5_000);
  });

  it("enforces the weekly token cap", async () => {
    const capped = makeFakePrisma({ config: { weeklyTokenCap: 100_000n } });
    await adjustBalance(capped.prisma, { userId: "u1", amountRupiah: 50_000, type: "GRANT" });
    await expect(convertToTokens(capped.prisma, { userId: "u1" })).rejects.toThrow(/weekly conversion cap/);
  });

  it("spends allowance against recorded usage", async () => {
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 12_000, type: "GRANT" });
    await convertToTokens(fake.prisma, { userId: "u1" });
    fake.usage.push({ userId: "u1", totalTokens: 250_000, billingStatus: "ALLOWANCE" });
    expect(await getAllowanceTokens(fake.prisma, "u1")).toBe(350_000);
  });

  it("never reports a negative allowance", async () => {
    fake.usage.push({ userId: "u1", totalTokens: 999_999, billingStatus: "ALLOWANCE" });
    expect(await getAllowanceTokens(fake.prisma, "u1")).toBe(0);
  });
});

describe("ledger listing", () => {
  it("returns newest first with numeric token grants", async () => {
    const fake = makeFakePrisma();
    await adjustBalance(fake.prisma, { userId: "u1", amountRupiah: 12_000, type: "GRANT", note: "hi" });
    await convertToTokens(fake.prisma, { userId: "u1" });
    const rows = await listLedger(fake.prisma, "u1");
    expect(rows[0].type).toBe("CONVERT");
    expect(rows[0].tokensGranted).toBe(600_000);
    expect(typeof rows[0].tokensGranted).toBe("number");
    expect(rows[0].amountRupiah).toBe(-12_000);
    expect(rows[1].type).toBe("GRANT");
  });
});
