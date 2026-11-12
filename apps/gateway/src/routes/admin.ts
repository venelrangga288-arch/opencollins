/**
 * Admin routes — role-gated. Also serves as RBAC middleware demonstration.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";

async function requireAdmin(req: FastifyRequest, deps: AppDeps): Promise<{ userId: string }> {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!bearer) throw new GatewayError("invalid_request", 401, "not authenticated");
  const jwt = await import("jsonwebtoken");
  let payload: { sub: string; role?: string };
  try {
    payload = jwt.verify(bearer, deps.jwtSecret) as { sub: string; role?: string };
  } catch {
    throw new GatewayError("invalid_request", 401, "invalid token");
  }
  if (payload.role !== "ADMIN") {
    throw new GatewayError("invalid_request", 403, "admin access required");
  }
  return { userId: payload.sub };
}

export const adminRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma, adapter } = opts.deps;

  app.addHook("onRequest", async (req) => {
    (req as unknown as { admin?: { userId: string } }).admin = await requireAdmin(req, opts.deps);
  });

  app.get("/users", async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    return { data: users };
  });

  app.patch("/users/:id/status", async (req) => {
    const admin = (req as unknown as { admin: { userId: string } }).admin;
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: "ACTIVE" | "SUSPENDED" };
    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      throw new GatewayError("invalid_request", 400, "status must be ACTIVE or SUSPENDED");
    }
    const user = await prisma.user.update({ where: { id }, data: { status } });
    if (status === "SUSPENDED") {
      await prisma.session.deleteMany({ where: { userId: id } });
      await prisma.apiKey.updateMany({ where: { userId: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
    }
    await prisma.auditLog.create({
      data: { actorId: admin.userId, action: `user.${status === "SUSPENDED" ? "suspended" : "reactivated"}`, target: `user:${id}` },
    });
    return { data: { id: user.id, status: user.status } };
  });

  app.get("/keys", async () => {
    const keys = await prisma.apiKey.findMany({
      where: { status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, name: true, prefix: true, status: true, lastUsedAt: true, requestCount: true, createdAt: true },
    });
    return { data: keys };
  });

  app.post("/keys/:id/revoke", async (req) => {
    const admin = (req as unknown as { admin: { userId: string } }).admin;
    const { id } = req.params as { id: string };
    await prisma.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorId: admin.userId, action: "key.admin_revoked", target: `apiKey:${id}` },
    });
    return { ok: true };
  });

  app.get("/requests", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(q.page ?? "1"));
    const pageSize = Math.min(100, Number(q.pageSize ?? "50"));
    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { email: true } } },
      }),
      prisma.requestLog.count(),
    ]);
    return { data: logs, page, total };
  });

  app.get("/provider/health", async () => {
    const health = await adapter.health();
    return { provider: adapter.slug, ...health };
  });

  app.get("/audit-logs", async (req) => {
    const q = req.query as { page?: string };
    const page = Math.max(1, Number(q.page ?? "1"));
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
      prisma.auditLog.count(),
    ]);
    return { data: logs, page, total };
  });
};
