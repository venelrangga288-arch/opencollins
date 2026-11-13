import "dotenv/config";
import { createAdapterFromEnv } from "@dgtlz/provider";
import { prisma } from "@dgtlz/db";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { buildApp } from "./app.js";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
  maxRetriesPerRequest: null,
});

export const usageQueue = new Queue("usage", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

const adapter = createAdapterFromEnv({
  UPSTREAM_BASE_URL: process.env.UPSTREAM_BASE_URL,
  UPSTREAM_API_KEY: process.env.UPSTREAM_API_KEY,
  UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
  PROVIDER_SLUG: process.env.PROVIDER_SLUG,
});

const app = await buildApp({
  adapter,
  prisma,
  redis,
  usageQueue,
  jwtSecret: process.env.JWT_SECRET ?? "",
  apiKeyHashSecret: process.env.API_KEY_HASH_SECRET ?? "",
  rateLimit: {
    requests: Number(process.env.RATE_LIMIT_REQUESTS ?? "60"),
    windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60"),
  },
  quota: {
    requestsPerDay: Number(process.env.DEFAULT_QUOTA_REQUESTS_PER_DAY ?? "1000"),
    tokensPerDay: Number(process.env.DEFAULT_QUOTA_TOKENS_PER_DAY ?? "1000000"),
  },
  maxBodyBytes: Number(process.env.MAX_REQUEST_BODY_BYTES ?? "2097152"),
});

const port = Number(process.env.GATEWAY_PORT ?? "4101");
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`DGT.LZ gateway listening on :${port} (provider: ${adapter.slug})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
}
