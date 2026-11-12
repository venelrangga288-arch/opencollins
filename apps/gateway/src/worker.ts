/**
 * Background worker — consumes the `usage` queue and writes UsageRecords.
 * Runs as a separate process (see docker-compose: worker service).
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@dgtlz/db";
import pino from "pino";
import { processUsageJob, type UsageJobData } from "./services/usage-logger.js";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", { maxRetriesPerRequest: null });

const worker = new Worker<UsageJobData>(
  "usage",
  async (job) => {
    await processUsageJob(prisma, job.data, log);
  },
  {
    connection: redis,
    concurrency: 4,
    limiter: { max: 100, duration: 1000 },
  },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err: err.message, attempts: job?.attemptsMade }, "usage job failed");
});
worker.on("completed", (job) => {
  log.debug({ jobId: job.id }, "usage job completed");
});

log.info("usage worker started");
