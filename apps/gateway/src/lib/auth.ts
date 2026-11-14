/**
 * Shared authentication helpers.
 *
 * Two credential types reach the gateway:
 *   - API keys (`Authorization: Bearer dgtlz_live_...`) — for programmatic clients
 *   - Dashboard sessions (httpOnly cookie or Bearer JWT) — for the web app
 *
 * `requireUserOrKey` accepts either, so the same endpoint powers both the
 * dashboard playground and real API traffic.
 */
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";
import { requireApiKey } from "../routes/keys.js";

export interface UserAuth {
  userId: string;
  role: "USER" | "ADMIN";
  /** Set only when the request authenticated with an API key. */
  apiKeyId: string | null;
}

/** Session auth via the httpOnly cookie or a dashboard JWT. */
export async function requireSessionUser(req: FastifyRequest, deps: AppDeps): Promise<UserAuth> {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, deps.jwtSecret) as { sub?: string; role?: string };
      if (!payload.sub) throw new Error("missing sub");
      const user = await deps.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });
      if (!user || user.status === "SUSPENDED") {
        throw new GatewayError("invalid_request", 401, "account suspended");
      }
      return { userId: user.id, role: user.role as "USER" | "ADMIN", apiKeyId: null };
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError("invalid_request", 401, "invalid session");
    }
  }

  const cookie = req.cookies?.["dgtlz_session"];
  if (!cookie) throw new GatewayError("invalid_request", 401, "not authenticated");
  const session = await deps.prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(cookie).digest("hex") },
    include: { user: { select: { id: true, role: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new GatewayError("invalid_request", 401, "session expired");
  }
  if (session.user.status === "SUSPENDED") {
    throw new GatewayError("invalid_request", 401, "account suspended");
  }
  return { userId: session.user.id, role: session.user.role as "USER" | "ADMIN", apiKeyId: null };
}

/** Accepts an API key OR a dashboard session. */
export async function requireUserOrKey(req: FastifyRequest, deps: AppDeps): Promise<UserAuth> {
  const header = req.headers.authorization ?? "";
  if (/^Bearer\s+dgtlz_/i.test(header)) {
    const auth = await requireApiKey(req, deps);
    return { userId: auth.userId, role: auth.role, apiKeyId: auth.apiKeyId };
  }
  // No API key and no dashboard session → the caller simply forgot to
  // authenticate; say so explicitly instead of a vague "not authenticated".
  if (!header && !req.cookies?.["dgtlz_session"]) {
    throw new GatewayError("missing_api_key", 401, "missing Authorization: Bearer <dgtlz_live_...> key");
  }
  return requireSessionUser(req, deps);
}
