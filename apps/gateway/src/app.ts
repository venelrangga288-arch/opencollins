import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { ProviderAdapter } from "@dgtlz/provider";
import type { PrismaClient } from "@dgtlz/db";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { newRequestId, toErrorBody, GatewayError } from "@dgtlz/core";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { keyRoutes } from "./routes/keys.js";
import { chatCompletions } from "./routes/chat.js";
import { modelsRoute, usageRoutes } from "./routes/usage.js";
import { adminRoutes } from "./routes/admin.js";
import { operatorRoutes } from "./routes/operator.js";import type { UsageJobData } from "./services/usage-logger.js";

export interface AppDeps {
  adapter: ProviderAdapter;
  prisma: PrismaClient;
  redis: Redis;
  usageQueue: Queue<UsageJobData>;
  jwtSecret: string;
  apiKeyHashSecret: string;
  rateLimit: { requests: number; windowSeconds: number };
  quota: { requestsPerDay: number; tokensPerDay: number };
  maxBodyBytes: number;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      userId: string;
      apiKeyId: string | null;
      role: "USER" | "ADMIN";
      requestId: string;
    };
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.apiKey",
          "*.apiKeyHash",
          "*.password",
          "*.passwordHash",
        ],
        censor: "[REDACTED]",
      },
      bodyLimit: deps.maxBodyBytes,
    },
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
  });
  await app.register((await import("@fastify/cookie")).default);

  // Some clients POST without a body (logout, cancel, …) and browsers/proxies
  // may attach a non-JSON content type. Accept those instead of 415-ing.
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "application/octet-stream"]) {
    app.addContentTypeParser(type, { parseAs: "string" }, (_req, body, done) => {
      const raw = String(body ?? "").trim();
      if (!raw) return done(null, {});
      try {
        done(null, JSON.parse(raw));
      } catch {
        done(null, {});
      }
    });
  }

  // Request ID + standardized error envelope
  app.addHook("onRequest", async (req) => {
    (req as unknown as { requestId: string }).requestId =
      (req.headers["x-request-id"] as string) || newRequestId();
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = (req as unknown as { requestId: string }).requestId;
    if (err instanceof GatewayError) {
      reply.status(err.httpStatus).send(toErrorBody(err.code, err.message, requestId));
      return;
    }
    if (err.validation) {
      reply.status(400).send(toErrorBody("invalid_request", err.message, requestId));
      return;
    }
    req.log.error({ err }, "unhandled error");
    reply.status(500).send(toErrorBody("internal_error", "internal server error", requestId));
  });

  app.get("/health", async () => ({ ok: true, service: "dgtlz-gateway" }));

  await app.register(authRoutes, { deps, prefix: "/api/v1/auth" });
  await app.register(keyRoutes, { deps, prefix: "/api/v1" });
  await app.register(agentRoutes, { deps, prefix: "/api/v1/agents" });
  await app.register(chatCompletions, { deps, prefix: "/api/v1" });
  await app.register(modelsRoute, { deps, prefix: "/api/v1" });
  await app.register(usageRoutes, { deps, prefix: "/api/v1" });
  await app.register(adminRoutes, { deps, prefix: "/api/v1/admin" });
  await app.register(operatorRoutes, { deps, prefix: "/api/v1/operator" });

  return app;
}
