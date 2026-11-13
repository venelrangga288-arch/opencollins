/**
 * API key authentication plugin logic + key management routes.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateApiKey, hashApiKey, extractBearerKey, GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";

export interface KeyAuth {
  userId: string;
  apiKeyId: string;
  role: "USER" | "ADMIN";
}

/** Verify a gateway API key from the Authorization header. Throws GatewayError. */
export async function requireApiKey(req: FastifyRequest, deps: AppDeps): Promise<KeyAuth> {
  const key = extractBearerKey(req.headers.authorization);
  if (!key) {
    throw new GatewayError("missing_api_key", 401, "missing Authorization: Bearer <dgtlz_live_...> key");
  }
  const keyHash = hashApiKey(key, deps.apiKeyHashSecret);
  const record = await deps.prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: { select: { id: true, role: true, status: true } } },
  });
  if (!record) {
    throw new GatewayError("invalid_api_key", 401, "invalid API key");
  }
  if (record.status === "REVOKED" || record.status === "DELETED") {
    throw new GatewayError("key_revoked", 401, "API key has been revoked");
  }
  if (record.user.status === "SUSPENDED") {
    throw new GatewayError("invalid_api_key", 403, "account suspended");
  }
  // fire-and-forget last-used update
  void deps.prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
  }).catch(() => {});
  return { userId: record.user.id, apiKeyId: record.id, role: record.user.role };
}

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
});

export const keyRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma } = opts.deps;

  /** Session/JWT auth for dashboard routes. */
  async function requireSession(req: FastifyRequest): Promise<{ userId: string; role: "USER" | "ADMIN" }> {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      const { default: jwt } = await import("jsonwebtoken");
      const payload = jwt.verify(bearer, opts.deps.jwtSecret) as { sub: string; role?: string };
      return { userId: payload.sub, role: (payload.role as "USER" | "ADMIN") ?? "USER" };
    }
    const cookie = req.cookies?.["dgtlz_session"];
    if (!cookie) throw new GatewayError("invalid_request", 401, "not authenticated");
    const { createHash } = await import("node:crypto");
    const session = await prisma.session.findUnique({
      where: { tokenHash: createHash("sha256").update(cookie).digest("hex") },
      include: { user: { select: { id: true, role: true, status: true } } },
    });
    if (!session || session.expiresAt < new Date() || session.user.status === "SUSPENDED") {
      throw new GatewayError("invalid_request", 401, "session expired");
    }
    return { userId: session.user.id, role: session.user.role as "USER" | "ADMIN" };
  }

  app.get("/keys", async (req) => {
    const auth = await requireSession(req);
    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.userId, status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, prefix: true, status: true,
        lastUsedAt: true, requestCount: true, createdAt: true, revokedAt: true,
      },
    });
    return { data: keys };
  });

  app.post("/keys", async (req, reply) => {
    const auth = await requireSession(req);
    const parsed = CreateKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, "key name required (1-100 chars)");
    }
    const generated = generateApiKey();
    const record = await prisma.apiKey.create({
      data: {
        userId: auth.userId,
        name: parsed.data.name,
        keyHash: generated.hash,
        prefix: generated.prefix,
      },
      select: { id: true, name: true, prefix: true, status: true, createdAt: true },
    });
    await prisma.auditLog.create({
      data: { actorId: auth.userId, action: "key.created", target: `apiKey:${record.id}` },
    });
    // Full key returned exactly once.
    return reply.status(201).send({ key: generated.key, record });
  });

  app.delete("/keys/:id", async (req, reply) => {
    const auth = await requireSession(req);
    const { id } = req.params as { id: string };
    const record = await prisma.apiKey.findUnique({ where: { id } });
    if (!record || record.userId !== auth.userId) {
      throw new GatewayError("invalid_request", 404, "key not found");
    }
    await prisma.apiKey.update({
      where: { id },
      data: { status: record.status === "ACTIVE" ? "REVOKED" : "DELETED", revokedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: { actorId: auth.userId, action: "key.revoked", target: `apiKey:${id}` },
    });
    return reply.send({ ok: true });
  });
};
