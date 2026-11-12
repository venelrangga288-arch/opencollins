/**
 * GET /models, GET /usage, GET /usage/summary — key-authenticated.
 */
import type { FastifyPluginAsync } from "fastify";
import { requireApiKey } from "./keys.js";
import type { AppDeps } from "../app.js";

export const modelsRoute: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get("/models", async (req) => {
    await requireApiKey(req, opts.deps);
    const models = await opts.deps.adapter.listModels();

    // Attach pricing only when verified rows exist.
    const pricingRows = await opts.deps.prisma.modelPricing.findMany({
      where: { providerSlug: opts.deps.adapter.slug, effectiveTo: null },
    });
    const priceMap = new Map(pricingRows.map((p) => [p.model, p]));

    return {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        display_name: m.displayName ?? m.id,
        context_window: m.contextWindow ?? null,
        pricing: priceMap.has(m.id)
          ? {
              input_per_1m_usd: Number(priceMap.get(m.id)!.inputPer1M),
              output_per_1m_usd: Number(priceMap.get(m.id)!.outputPer1M),
            }
          : null, // null = unverified — never fabricated
      })),
    };
  });
};

export const usageRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const requireKey = async (req: Parameters<typeof requireApiKey>[1]) => requireApiKey(req as never, opts.deps);

  app.get("/usage", async (req) => {
    const auth = await requireKey(req);
    const q = req.query as { page?: string; pageSize?: string; since?: string; until?: string };
    const page = Math.max(1, Number(q.page ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? "25")));
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 30 * 86400_000);
    const until = q.until ? new Date(q.until) : new Date();

    const [records, total] = await Promise.all([
      opts.deps.prisma.usageRecord.findMany({
        where: { userId: auth.userId, recordedAt: { gte: since, lte: until } },
        orderBy: { recordedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      opts.deps.prisma.usageRecord.count({ where: { userId: auth.userId, recordedAt: { gte: since, lte: until } } }),
    ]);
    return { data: records, page, pageSize, total };
  });

  app.get("/usage/summary", async (req) => {
    const auth = await requireKey(req);
    const q = req.query as { since?: string; until?: string };
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 30 * 86400_000);
    const until = q.until ? new Date(q.until) : new Date();

    const where = { userId: auth.userId, recordedAt: { gte: since, lte: until } };
    const [totals, byModel, byDay] = await Promise.all([
      opts.deps.prisma.usageRecord.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _count: true,
      }),
      opts.deps.prisma.usageRecord.groupBy({
        by: ["model"],
        where,
        _sum: { totalTokens: true, estimatedCost: true },
        _count: true,
      }),
      opts.deps.prisma.$queryRaw<Array<{ day: Date; requests: bigint; tokens: bigint | null; cost: number | null }>>`
        SELECT date_trunc('day', "recordedAt") AS day,
               COUNT(*) AS requests,
               SUM("totalTokens") AS tokens,
               SUM("estimatedCost") AS cost
        FROM "UsageRecord"
        WHERE "userId" = ${auth.userId} AND "recordedAt" >= ${since} AND "recordedAt" <= ${until}
        GROUP BY 1 ORDER BY 1`,
    ]);

    return {
      totals: {
        requests: totals._count,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        estimatedCostUsd: totals._sum.estimatedCost ? Number(totals._sum.estimatedCost) : null,
      },
      byModel: byModel.map((m) => ({
        model: m.model,
        requests: m._count,
        totalTokens: m._sum.totalTokens ?? 0,
        estimatedCostUsd: m._sum.estimatedCost ? Number(m._sum.estimatedCost) : null,
      })),
      byDay: byDay.map((d) => ({
        day: d.day,
        requests: Number(d.requests),
        tokens: Number(d.tokens ?? 0),
        estimatedCostUsd: d.cost !== null ? Number(d.cost) : null,
      })),
    };
  });
};
