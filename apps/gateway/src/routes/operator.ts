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
  const { prisma, adapter, jwtSecret } = opts.deps;

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
};
