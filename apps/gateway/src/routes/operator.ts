/**
 * Operator console API — /api/v1/operator
 * Login dengan username/password (env OPERATOR_USERNAME / OPERATOR_PASSWORD).
 * Session = JWT role OPERATOR (12 jam). Semua endpoint lain di sini butuh token itu.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";

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
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
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
    const { createHash, randomBytes } = await import("node:crypto");
    const passwordHash = createHash("sha256").update(parsed.data.password + (process.env.JWT_SECRET ?? "")).digest("hex");
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        name: parsed.data.name,
        role: parsed.data.role ?? "USER",
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    await prisma.auditLog.create({ data: { actorId: "operator", action: "user.created", target: `user:${user.id}` } });
    return user;
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
    void (async () => {
      let totalTokens = 0;
      let firstError: string | null = null;
      for (const step of agent.steps) {
        try {
          const result = await adapter.chat({
            model,
            messages: [{ role: "user", content: step.prompt }],
            max_tokens: 2000,
          });
          const body = result.body as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
          } | null;
          const tokens = body?.usage?.total_tokens ?? 0;
          totalTokens += tokens;
          await prisma.agentStep.update({
            where: { id: step.id },
            data: {
              status: "COMPLETED",
              result: (body?.choices?.[0]?.message?.content ?? "").slice(0, 8000),
              tokens,
              latencyMs: result.latencyMs,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "step failed";
          if (!firstError) firstError = `step ${step.index}: ${msg}`;
          await prisma.agentStep.update({
            where: { id: step.id },
            data: { status: "FAILED", error: msg.slice(0, 500) },
          });
          break;
        }
      }
      await prisma.agent.update({
        where: { id: agent.id },
        data: { status: firstError ? "FAILED" : "COMPLETED", totalTokens, error: firstError, finishedAt: new Date() },
      });
    })().catch(() => {});

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
};
