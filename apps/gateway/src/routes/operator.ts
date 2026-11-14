/**
 * Operator console API â€” /api/v1/operator
 * Login dengan username/password (env OPERATOR_USERNAME / OPERATOR_PASSWORD).
 * Session = JWT role OPERATOR (12 jam). Semua endpoint lain di sini butuh token itu.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";
import { runAgent } from "../services/agent-runner.js";
import {
  adjustBalance,
  getAllowanceTokens,
  getBalanceRupiah,
  listLedger,
  loadConfig,
  toConfigView,
  DEFAULT_CONFIG,
} from "../services/credits.js";

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

function verifyOperator(req: FastifyRequest, secret: string): void {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!bearer) throw new GatewayError("invalid_request", 401, "operator auth required");
  try {
    const payload = jwt.verify(bearer, secret) as { sub?: string; role?: string };
    if (payload.role !== "OPERATOR") throw new Error("bad role");
  } catch {
    throw new GatewayError("invalid_request", 401, "operator session invalid or expired");
  }
}

export const operatorRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma, adapter, jwtSecret, apiKeyHashSecret } = opts.deps;

  app.post("/login", async (req) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "username and password required");
    const u = process.env.OPERATOR_USERNAME ?? "123";
    const p = process.env.OPERATOR_PASSWORD ?? "123123";
    if (parsed.data.username !== u || parsed.data.password !== p) {
      throw new GatewayError("invalid_request", 401, "invalid operator credentials");
    }
    const token = jwt.sign({ sub: "operator", role: "OPERATOR" }, jwtSecret, { expiresIn: "12h" });
    await prisma.auditLog.create({
      data: { actorId: "operator", action: "operator.login", target: "operator-console" },
    });
    return { token, expiresInHours: 12 };
  });

  app.get("/stats", async (req) => {
    verifyOperator(req, jwtSecret);
    const since = new Date(Date.now() - 86400_000);
    const [users, activeKeys, requests24h, errors24h, avg, tokens] = await Promise.all([
      prisma.user.count(),
      prisma.apiKey.count({ where: { status: "ACTIVE" } }),
      prisma.requestLog.count({ where: { createdAt: { gte: since } } }),
      prisma.requestLog.count({ where: { createdAt: { gte: since }, status: { not: "SUCCESS" } } }),
      prisma.requestLog.aggregate({ where: { createdAt: { gte: since } }, _avg: { latencyMs: true } }),
      prisma.usageRecord.aggregate({ where: { recordedAt: { gte: since } }, _sum: { totalTokens: true } }),
    ]);
    return {
      users,
      activeKeys,
      requests24h,
      errors24h,
      avgLatencyMs: Math.round(avg._avg.latencyMs ?? 0),
      tokens24h: tokens._sum.totalTokens ?? 0,
    };
  });

  app.get("/users", async (req) => {
    verifyOperator(req, jwtSecret);
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, email: true, name: true, role: true, status: true, createdAt: true,
        usageQuota: { select: { requestsPerDay: true, tokensPerDay: true } },
        _count: { select: { apiKeys: true, agents: true } },
      },
    });
    return { data: users };
  });

  app.patch("/users/:id/status", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: "ACTIVE" | "SUSPENDED" };
    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      throw new GatewayError("invalid_request", 400, "status must be ACTIVE or SUSPENDED");
    }
    await prisma.user.update({ where: { id }, data: { status } });
    if (status === "SUSPENDED") {
      await prisma.session.deleteMany({ where: { userId: id } });
      await prisma.apiKey.updateMany({
        where: { userId: id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    }
    await prisma.auditLog.create({
      data: { actorId: "operator", action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated", target: `user:${id}` },
    });
    return { ok: true };
  });

  app.get("/keys", async (req) => {
    verifyOperator(req, jwtSecret);
    const keys = await prisma.apiKey.findMany({
      where: { status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, userId: true, name: true, prefix: true, status: true,
        lastUsedAt: true, requestCount: true, createdAt: true,
        user: { select: { email: true } },
      },
    });
    return { data: keys };
  });

  app.post("/keys/:id/revoke", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    await prisma.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "key.admin_revoked", target: `apiKey:${id}` } });
    return { ok: true };
  });

  app.get("/requests", async (req) => {
    verifyOperator(req, jwtSecret);
    const logs = await prisma.requestLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { email: true } } },
    });
    return { data: logs };
  });

  app.get("/provider/health", async (req) => {
    verifyOperator(req, jwtSecret);
    const health = await adapter.health();
    return { provider: adapter.slug, ...health };
  });

  app.get("/audit-logs", async (req) => {
    verifyOperator(req, jwtSecret);
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return { data: logs };
  });

  // ============ FULL CONTROL EXTENSIONS ============

  /** Create a user (optionally as ADMIN). */
  const CreateUserSchema = z.object({
    email: z.string().email().max(200),
    password: z.string().min(8).max(128),
    name: z.string().max(120).optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
  });
  app.post("/users", async (req) => {
    verifyOperator(req, jwtSecret);
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "valid email + password (min 8 chars) required");
    // Must match the login path (bcrypt) — otherwise these accounts can never sign in.
    const bcrypt = (await import("bcryptjs")).default;
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        name: parsed.data.name,
        role: parsed.data.role ?? "USER",
        usageQuota: {
          create: {
            requestsPerDay: opts.deps.quota.requestsPerDay,
            tokensPerDay: opts.deps.quota.tokensPerDay,
          },
        },
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "user.created", target: `user:${user.id}` } });
    return user;
  });

  /** Reset a user's password (operator). */
  const ResetPasswordSchema = z.object({ password: z.string().min(8).max(128) });
  app.patch("/users/:id/password", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "password must be 8-128 characters");
    const bcrypt = (await import("bcryptjs")).default;
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    // Invalidate existing sessions so the old password can't be reused.
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "user.password_reset", target: `user:${id}` } });
    return { ok: true };
  });

  /** Create an API key ON BEHALF of a user. Full key returned exactly once. */
  const CreateKeySchema = z.object({
    userId: z.string().min(1),
    name: z.string().min(1).max(80),
  });
  app.post("/users/keys", async (req) => {
    verifyOperator(req, jwtSecret);
    const parsed = CreateKeySchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "userId and name required");
    const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
    if (!user) throw new GatewayError("invalid_request", 404, "user not found");
    const { generateApiKey } = await import("@dgtlz/core");
    const generated = generateApiKey(apiKeyHashSecret);
    const key = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        keyHash: generated.hash,
        prefix: generated.prefix,
      },
      select: { id: true, name: true, prefix: true, status: true, createdAt: true },
    });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "key.created_for_user", target: `apiKey:${key.id}`, metadata: { userId: user.id } } });
    return { ...key, key: generated.key };
  });

  /** Update a user's daily quota. */
  const QuotaSchema = z.object({
    requestsPerDay: z.number().int().min(1).max(1_000_000).optional(),
    tokensPerDay: z.number().int().min(1000).max(1_000_000_000).optional(),
  });
  app.patch("/users/:id/quota", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const parsed = QuotaSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.requestsPerDay && !parsed.data.tokensPerDay)) {
      throw new GatewayError("invalid_request", 400, "requestsPerDay and/or tokensPerDay required");
    }
    const quota = await prisma.usageQuota.upsert({
      where: { userId: id },
      create: {
        userId: id,
        requestsPerDay: parsed.data.requestsPerDay ?? 1000,
        tokensPerDay: parsed.data.tokensPerDay ?? 1_000_000,
      },
      update: {
        ...(parsed.data.requestsPerDay !== undefined && { requestsPerDay: parsed.data.requestsPerDay }),
        ...(parsed.data.tokensPerDay !== undefined && { tokensPerDay: parsed.data.tokensPerDay }),
      },
    });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "user.quota_updated", target: `user:${id}`, metadata: parsed.data } });
    return quota;
  });

  /** Usage overview: per-user totals over the last N days. */
  app.get("/usage", async (req) => {
    verifyOperator(req, jwtSecret);
    const days = Math.min(Number((req.query as { days?: string }).days ?? "7") || 7, 90);
    const since = new Date(Date.now() - days * 86400_000);
    const records = await prisma.usageRecord.findMany({
      where: { recordedAt: { gte: since } },
      select: { userId: true, model: true, inputTokens: true, outputTokens: true, totalTokens: true },
    });
    const byUser = new Map<string, { requests: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
    const byModel = new Map<string, { requests: number; totalTokens: number }>();
    for (const r of records) {
      const u = byUser.get(r.userId) ?? { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      u.requests++; u.inputTokens += r.inputTokens ?? 0; u.outputTokens += r.outputTokens ?? 0; u.totalTokens += r.totalTokens ?? 0;
      byUser.set(r.userId, u);
      const m = byModel.get(r.model) ?? { requests: 0, totalTokens: 0 };
      m.requests++; m.totalTokens += r.totalTokens ?? 0;
      byModel.set(r.model, m);
    }
    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    return {
      days,
      byUser: [...byUser.entries()].map(([id, v]) => ({ userId: id, email: emailOf.get(id) ?? id, ...v })),
      byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })),
    };
  });

  /** Live test chat through the gateway (uses the provider directly). */
  const TestChatSchema = z.object({
    model: z.string().min(1).max(80),
    prompt: z.string().min(1).max(2000),
  });
  app.post("/test-chat", async (req) => {
    verifyOperator(req, jwtSecret);
    const parsed = TestChatSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "model and prompt required");
    const result = await adapter.chat({
      model: parsed.data.model,
      messages: [{ role: "user", content: parsed.data.prompt }],
      max_tokens: 200,
    });
    const body = result.body as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } } | null;
    return {
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      content: body?.choices?.[0]?.message?.content ?? null,
      usage: body?.usage ?? null,
    };
  });

  /** Models currently available from the provider. */
  app.get("/models", async (req) => {
    verifyOperator(req, jwtSecret);
    const models = await adapter.listModels().catch(() => []);
    return { data: models };
  });

  // ============ AGENTS (operator management) ============

  /** All agents across all users, with owner email. */
  app.get("/agents", async (req) => {
    verifyOperator(req, jwtSecret);
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { email: true } },
        steps: { orderBy: { index: "asc" }, select: { index: true, status: true, tokens: true } },
      },
    });
    return { data: agents };
  });

  /** Deploy an agent ON BEHALF of a user. */
  const OpDeploySchema = z.object({
    userId: z.string().min(1),
    name: z.string().min(1).max(80),
    model: z.string().min(1).max(80),
    prompts: z.array(z.string().min(1).max(4000)).min(1).max(20),
  });
  app.post("/agents/deploy", async (req) => {
    verifyOperator(req, jwtSecret);
    const parsed = OpDeploySchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, "userId, name, model and prompts required");
    const { userId, name, model, prompts } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new GatewayError("invalid_request", 404, "user not found");

    const agent = await prisma.agent.create({
      data: {
        userId,
        name,
        model,
        status: "RUNNING",
        runBy: "OPERATOR",
        startedAt: new Date(),
        steps: { create: prompts.map((prompt, index) => ({ index, prompt })) },
      },
      include: { steps: { orderBy: { index: "asc" } } },
    });

    // Same background execution as the user-facing deploy.
    void runAgent(opts.deps, agent.id).catch(() => {});

    await prisma.auditLog.create({
      data: { actorId: "operator", action: "agent.deployed_for_user", target: `agent:${agent.id}`, metadata: { userId, name, model, steps: prompts.length } },
    });
    return { agent: { id: agent.id, name: agent.name, status: agent.status } };
  });

  /** Operator cancel any agent. */
  app.post("/agents/:id/cancel", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new GatewayError("invalid_request", 404, "agent not found");
    if (agent.status === "COMPLETED" || agent.status === "FAILED") {
      throw new GatewayError("invalid_request", 400, "agent already finished");
    }
    await prisma.agent.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "agent.cancelled", target: `agent:${id}` } });
    return { ok: true };
  });
  // -------------------------------------------------------------------------
  // Credits, ads and creative management
  // -------------------------------------------------------------------------

  /** Global ads/credits knobs. Everything here is runtime-editable. */
  app.get("/credits/config", async (req) => {
    verifyOperator(req, jwtSecret);
    return loadConfig(prisma);
  });

  const CreditConfigSchema = z.object({
    tokensPerRupiah: z.number().int().min(1).max(1_000_000).optional(),
    minConvertRupiah: z.number().int().min(0).max(10_000_000).optional(),
    dailyAdsPerUser: z.number().int().min(0).max(1000).optional(),
    dailyRewardCapRupiah: z.number().int().min(0).max(100_000_000).optional(),
    weeklyTokenCap: z.number().int().min(0).max(1_000_000_000_000).optional(),
    minWatchPercent: z.number().int().min(1).max(100).optional(),
    sessionTtlSeconds: z.number().int().min(30).max(3600).optional(),
    adsEnabled: z.boolean().optional(),
  });

  app.patch("/credits/config", async (req) => {
    verifyOperator(req, jwtSecret);
    const parsed = CreditConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    }
    const d = parsed.data;
    const cfg = await prisma.creditConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        tokensPerRupiah: d.tokensPerRupiah ?? DEFAULT_CONFIG.tokensPerRupiah,
        minConvertRupiah: d.minConvertRupiah ?? DEFAULT_CONFIG.minConvertRupiah,
        dailyAdsPerUser: d.dailyAdsPerUser ?? DEFAULT_CONFIG.dailyAdsPerUser,
        dailyRewardCapRupiah: d.dailyRewardCapRupiah ?? DEFAULT_CONFIG.dailyRewardCapRupiah,
        weeklyTokenCap: BigInt(d.weeklyTokenCap ?? Number(DEFAULT_CONFIG.weeklyTokenCap)),
        minWatchPercent: d.minWatchPercent ?? DEFAULT_CONFIG.minWatchPercent,
        sessionTtlSeconds: d.sessionTtlSeconds ?? DEFAULT_CONFIG.sessionTtlSeconds,
        adsEnabled: d.adsEnabled ?? DEFAULT_CONFIG.adsEnabled,
      },
      update: {
        ...(d.tokensPerRupiah !== undefined && { tokensPerRupiah: d.tokensPerRupiah }),
        ...(d.minConvertRupiah !== undefined && { minConvertRupiah: d.minConvertRupiah }),
        ...(d.dailyAdsPerUser !== undefined && { dailyAdsPerUser: d.dailyAdsPerUser }),
        ...(d.dailyRewardCapRupiah !== undefined && { dailyRewardCapRupiah: d.dailyRewardCapRupiah }),
        ...(d.weeklyTokenCap !== undefined && { weeklyTokenCap: BigInt(d.weeklyTokenCap) }),
        ...(d.minWatchPercent !== undefined && { minWatchPercent: d.minWatchPercent }),
        ...(d.sessionTtlSeconds !== undefined && { sessionTtlSeconds: d.sessionTtlSeconds }),
        ...(d.adsEnabled !== undefined && { adsEnabled: d.adsEnabled }),
      },
    });
    await prisma.auditLog.create({
      data: { actorId: "operator", action: "credits.config_updated", target: "credit-config", metadata: d },
    });
    return toConfigView(cfg);
  });

  /** The ad catalogue plus per-creative reward ranges and play counts. */
  app.get("/ads/creatives", async (req) => {
    verifyOperator(req, jwtSecret);
    const creatives = await prisma.adCreative.findMany({ orderBy: { slug: "asc" } });
    const stats = await prisma.adSession.groupBy({ by: ["creativeId", "status"], _count: true });
    const statMap = new Map<string, Record<string, number>>();
    for (const s of stats) {
      const row = statMap.get(s.creativeId) ?? {};
      row[s.status] = s._count;
      statMap.set(s.creativeId, row);
    }
    return {
      creatives: creatives.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        brand: c.brand,
        tagline: c.tagline,
        videoUrl: c.videoUrl,
        posterUrl: c.posterUrl,
        accent: c.accent,
        durationMs: c.durationMs,
        source: c.source,
        sourceUrl: c.sourceUrl,
        license: c.license,
        rewardMinRupiah: c.rewardMinRupiah,
        rewardMaxRupiah: c.rewardMaxRupiah,
        active: c.active,
        sessions: statMap.get(c.id) ?? {},
      })),
    };
  });

  const CreativeSchema = z.object({
    title: z.string().min(1).max(120).optional(),
    tagline: z.string().max(200).nullable().optional(),
    rewardMinRupiah: z.number().int().min(0).max(1_000_000).optional(),
    rewardMaxRupiah: z.number().int().min(0).max(1_000_000).optional(),
    active: z.boolean().optional(),
  });

  app.patch("/ads/creatives/:id", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const parsed = CreativeSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    const d = parsed.data;
    if (
      d.rewardMinRupiah !== undefined &&
      d.rewardMaxRupiah !== undefined &&
      d.rewardMinRupiah > d.rewardMaxRupiah
    ) {
      throw new GatewayError("invalid_request", 400, "rewardMinRupiah must be <= rewardMaxRupiah");
    }
    const updated = await prisma.adCreative.update({
      where: { id },
      data: {
        ...(d.title !== undefined && { title: d.title }),
        ...(d.tagline !== undefined && { tagline: d.tagline }),
        ...(d.rewardMinRupiah !== undefined && { rewardMinRupiah: d.rewardMinRupiah }),
        ...(d.rewardMaxRupiah !== undefined && { rewardMaxRupiah: d.rewardMaxRupiah }),
        ...(d.active !== undefined && { active: d.active }),
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: "operator",
        action: "ads.creative_updated",
        target: "creative:" + id,
        metadata: d,
      },
    });
    return updated;
  });

  /** Per-user wallet view. */
  app.get("/users/:id/credits", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const [balance, allowance, entries] = await Promise.all([
      getBalanceRupiah(prisma, id),
      getAllowanceTokens(prisma, id),
      listLedger(prisma, id, 50),
    ]);
    const adsToday = await prisma.adSession.count({
      where: {
        userId: id,
        status: "COMPLETED",
        completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });
    return {
      userId: id,
      balanceRupiah: balance,
      allowanceTokens: allowance,
      adsWatchedToday: adsToday,
      entries,
    };
  });

  /** Manual credit/debit: top-ups, goodwill grants, corrections. */
  const AdjustSchema = z.object({
    amountRupiah: z.number().int().min(-10_000_000).max(10_000_000),
    type: z.enum(["TOPUP", "GRANT", "ADJUSTMENT", "REFUND"]).default("GRANT"),
    note: z.string().max(200).optional(),
  });

  app.post("/users/:id/credits", async (req) => {
    verifyOperator(req, jwtSecret);
    const { id } = req.params as { id: string };
    const parsed = AdjustSchema.safeParse(req.body);
    if (!parsed.success) throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    const result = await adjustBalance(prisma, {
      userId: id,
      amountRupiah: parsed.data.amountRupiah,
      type: parsed.data.type,
      source: parsed.data.type === "TOPUP" ? "PAYMENT" : "OPERATOR",
      note: parsed.data.note,
      actorId: "operator",
    });
    await prisma.auditLog.create({
      data: {
        actorId: "operator",
        action: "credits.adjusted",
        target: "user:" + id,
        metadata: { ...parsed.data, balanceAfter: result.balanceRupiah },
      },
    });
    return { userId: id, ...result };
  });

  /** Ads funnel: issued vs completed vs rejected over the last 7 days. */
  app.get("/ads/stats", async (req) => {
    verifyOperator(req, jwtSecret);
    const since = new Date(Date.now() - 7 * 86400_000);
    const [byStatus, rewardAgg, topEarners] = await Promise.all([
      prisma.adSession.groupBy({ by: ["status"], where: { issuedAt: { gte: since } }, _count: true }),
      prisma.creditLedgerEntry.aggregate({
        where: { type: "AD_REWARD", createdAt: { gte: since } },
        _sum: { amountRupiah: true },
        _count: true,
      }),
      prisma.creditLedgerEntry.groupBy({
        by: ["userId"],
        where: { type: "AD_REWARD", createdAt: { gte: since } },
        _sum: { amountRupiah: true },
        orderBy: { _sum: { amountRupiah: "desc" } },
        take: 5,
      }),
    ]);
    const users = await prisma.user.findMany({
      where: { id: { in: topEarners.map((t) => t.userId) } },
      select: { id: true, email: true },
    });
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    return {
      days: 7,
      sessions: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      rewards: { count: rewardAgg._count, totalRupiah: rewardAgg._sum.amountRupiah ?? 0 },
      topEarners: topEarners.map((t) => ({
        userId: t.userId,
        email: emailOf.get(t.userId) ?? t.userId,
        earnedRupiah: t._sum.amountRupiah ?? 0,
      })),
    };
  });

};
