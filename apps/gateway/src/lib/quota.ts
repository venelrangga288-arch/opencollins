/** Daily quota enforcement shared by the chat route and the agent runner. */
import type { AppDeps } from "../app.js";
import { GatewayError } from "@dgtlz/core";

export async function assertWithinQuota(deps: AppDeps, userId: string): Promise<void> {
  const quota = await deps.prisma.usageQuota.findUnique({ where: { userId } });
  if (!quota) return;

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [requestCount, tokenSum] = await Promise.all([
    deps.prisma.requestLog.count({ where: { userId, createdAt: { gte: since } } }),
    deps.prisma.usageRecord.aggregate({
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
