/**
 * POST /chat/completions — the core gateway route.
 * Auth → rate limit → quota → provider → usage enqueue → response.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import { requireApiKey } from "./keys.js";
import type { AppDeps } from "../app.js";
import type { UsageJobData } from "../services/usage-logger.js";

const ChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(z.any()), z.null()]),
  })).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
}).passthrough();

export const chatCompletions: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { adapter, prisma, redis, usageQueue } = opts.deps;

  async function checkRateLimit(userId: string): Promise<void> {
    const windowSec = opts.deps.rateLimit.windowSeconds;
    const redisKey = `rl:${userId}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSec);
    if (count > opts.deps.rateLimit.requests) {
      throw new GatewayError("rate_limited", 429, `rate limit exceeded: ${opts.deps.rateLimit.requests} requests / ${windowSec}s`);
    }
  }

  async function checkQuota(userId: string): Promise<void> {
    const quota = await prisma.usageQuota.findUnique({ where: { userId } });
    if (!quota) return;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [requestCount, tokenSum] = await Promise.all([
      prisma.requestLog.count({ where: { userId, createdAt: { gte: since } } }),
      prisma.usageRecord.aggregate({
        where: { userId, recordedAt: { gte: since } },
        _sum: { totalTokens: true },
      }),
    ]);
    if (requestCount >= quota.requestsPerDay) {
      throw new GatewayError("quota_exceeded", 429, `daily request quota exceeded (${quota.requestsPerDay})`);
    }
    const tokens = tokenSum._sum.totalTokens ?? 0;
    if (tokens >= quota.tokensPerDay) {
      throw new GatewayError("quota_exceeded", 429, `daily token quota exceeded (${quota.tokensPerDay})`);
    }
  }

  app.post("/chat/completions", async (req, reply) => {
    const auth = await requireApiKey(req, opts.deps);
    const requestId = (req as unknown as { requestId: string }).requestId;

    await checkRateLimit(auth.userId);
    await checkQuota(auth.userId);

    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, parsed.error.issues[0].message);
    }
    const body = parsed.data;
    const model = body.model;

    // Ensure provider + model exist locally; unknown model = 404 before upstream call.
    const provider = await prisma.provider.upsert({
      where: { slug: adapter.slug },
      create: { slug: adapter.slug, name: adapter.slug, baseUrl: "" },
      update: {},
    });
    const modelRecord = await prisma.model.findUnique({
      where: { providerId_providerModelId: { providerId: provider.id, providerModelId: model } },
    });
    if (modelRecord && !modelRecord.available) {
      throw new GatewayError("model_not_found", 404, `model '${model}' is not available`);
    }
    if (!modelRecord) {
      // First-seen model: register from provider's verified list only.
      const upstreamModels = await adapter.listModels().catch(() => []);
      if (upstreamModels.length > 0 && !upstreamModels.some((m) => m.id === model)) {
        throw new GatewayError("model_not_found", 404, `model '${model}' not offered by provider`);
      }
      await prisma.model.create({
        data: { providerId: provider.id, providerModelId: model, displayName: model, available: true },
      }).catch(() => {});
    }

    const job: UsageJobData = {
      requestId,
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      providerSlug: adapter.slug,
      model,
      endpoint: "/chat/completions",
      latencyMs: 0,
      httpStatus: 200,
    };

    if (body.stream) {
      const streamResult = await adapter.stream({ ...body, extra: {} } as never);
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-request-id": requestId,
      });
      const chunks: unknown[] = [];
      for await (const ev of streamResult.events) {
        reply.raw.write(`data: ${ev.data}\n\n`);
        try { chunks.push(JSON.parse(ev.data)); } catch { /* [DONE] etc. */ }
      }
      reply.raw.end("data: [DONE]\n\n");

      // Enqueue usage with the chunks so the worker can extract usage.
      const usage = await streamResult.usage.catch(() => null);
      await usageQueue.add("record", {
        ...job,
        streamed: true,
        streamChunks: chunks,
        usage,
        latencyMs: streamResult.latencyMs,
      });
      return;
    }

    // Non-streaming
    const result = await adapter.chat({ ...body, extra: {} } as never);
    if (result.httpStatus >= 400) {
      // Record the failure, then surface provider error compatibly.
      await usageQueue.add("record", { ...job, httpStatus: result.httpStatus, responseBody: result.body, latencyMs: result.latencyMs });
      throw new GatewayError("provider_error", result.httpStatus === 429 ? 429 : 502,
        `provider returned HTTP ${result.httpStatus}`, result.httpStatus);
    }

    await usageQueue.add("record", {
      ...job,
      httpStatus: result.httpStatus,
      responseBody: result.body,
      latencyMs: result.latencyMs,
    });

    return reply
      .header("x-request-id", requestId)
      .status(result.httpStatus)
      .send(result.body);
  });
};
