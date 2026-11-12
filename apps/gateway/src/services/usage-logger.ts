/**
 * Usage logging — asynchronous via BullMQ. Never blocks the AI response path.
 * Idempotency: UsageRecord.requestId is UNIQUE; duplicate jobs are no-ops.
 */
import type { PrismaClient, ModelPricing } from "@dgtlz/db";
import type { Logger } from "pino";
import { computeCost, extractUsage, extractUsageFromStream, type Pricing } from "@dgtlz/core";

export interface UsageJobData {
  requestId: string;
  userId: string;
  apiKeyId: string | null;
  providerSlug: string;
  model: string;
  endpoint: string;
  latencyMs: number;
  httpStatus: number;
  /** Pre-extracted usage when the request path already has it (streaming). */
  usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  /** Raw provider JSON body when usage must be extracted in the worker (non-stream). */
  responseBody?: unknown;
  streamed?: boolean;
  streamChunks?: unknown[];
}

/** Resolve the pricing row effective at recording time. */
export async function resolvePricing(prisma: PrismaClient, providerSlug: string, model: string): Promise<Pricing | null> {
  const row: ModelPricing | null = await prisma.modelPricing.findFirst({
    where: {
      providerSlug,
      model,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) return null;
  return { inputPer1M: Number(row.inputPer1M), outputPer1M: Number(row.outputPer1M) };
}

export async function processUsageJob(prisma: PrismaClient, job: UsageJobData, log: Logger): Promise<void> {
  // Idempotency guard: skip if a usage record for this requestId already exists.
  const existing = await prisma.usageRecord.findUnique({ where: { requestId: job.requestId }, select: { id: true } });
  if (existing) {
    log.debug({ requestId: job.requestId }, "usage record already exists — skipping duplicate");
    return;
  }

  let usage = job.usage ?? null;
  if (!usage) {
    if (job.streamed) {
      usage = extractUsageFromStream(job.streamChunks ?? []).usage;
    } else {
      usage = extractUsage(job.responseBody).usage;
    }
  }

  const pricing = await resolvePricing(prisma, job.providerSlug, job.model);
  const { estimatedCost, billingStatus } = computeCost(
    { inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null },
    pricing,
  );

  // Upsert semantics protect against races between retries.
  await prisma.usageRecord.upsert({
    where: { requestId: job.requestId },
    create: {
      requestId: job.requestId,
      userId: job.userId,
      apiKeyId: job.apiKeyId,
      provider: job.providerSlug,
      model: job.model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      latencyMs: job.latencyMs,
      estimatedCost,
      billingStatus,
    },
    update: {},
  });

  await prisma.requestLog.upsert({
    where: { requestId: job.requestId },
    create: {
      requestId: job.requestId,
      userId: job.userId,
      apiKeyId: job.apiKeyId,
      providerId: await resolveProviderId(prisma, job.providerSlug),
      model: job.model,
      endpoint: job.endpoint,
      status: job.httpStatus >= 200 && job.httpStatus < 300 ? "SUCCESS" : "PROVIDER_ERROR",
      httpStatus: job.httpStatus,
      latencyMs: job.latencyMs,
    },
    update: {},
  });

  log.info({ requestId: job.requestId, model: job.model, cost: estimatedCost }, "usage recorded");
}

async function resolveProviderId(prisma: PrismaClient, slug: string): Promise<string> {
  const provider = await prisma.provider.upsert({
    where: { slug },
    create: { slug, name: slug, baseUrl: "" },
    update: {},
    select: { id: true },
  });
  return provider.id;
}
