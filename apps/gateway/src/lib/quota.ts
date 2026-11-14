/** Daily quota + allowance-token enforcement, shared by chat and the agent runner. */
import type { AppDeps } from "../app.js";
import { GatewayError } from "@dgtlz/core";
import { getAllowanceTokens } from "../services/credits.js";

export interface QuotaState {
  requestsToday: number;
  requestsPerDay: number;
  tokensToday: number;
  tokensPerDay: number;
  /** Allowance tokens bought by converting ad/top-up balance. Spent first. */
  allowanceTokens: number;
}

/** Reads the current usage counters without throwing — used by the UI. */
export async function readQuotaState(deps: AppDeps, userId: string): Promise<QuotaState> {
  const quota = await deps.prisma.usageQuota.findUnique({ where: { userId } });
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [requestCount, tokenSum, allowanceTokens] = await Promise.all([
    deps.prisma.requestLog.count({ where: { userId, createdAt: { gte: since } } }),
    deps.prisma.usageRecord.aggregate({
      where: { userId, recordedAt: { gte: since } },
      _sum: { totalTokens: true },
    }),
    getAllowanceTokens(deps.prisma, userId),
  ]);

  return {
    requestsToday: requestCount,
    requestsPerDay: quota?.requestsPerDay ?? deps.quota.requestsPerDay,
    tokensToday: tokenSum._sum.totalTokens ?? 0,
    tokensPerDay: quota?.tokensPerDay ?? deps.quota.tokensPerDay,
    allowanceTokens,
  };
}

/**
 * A request is allowed when either the free daily quota or the paid allowance
 * still has room. Allowance tokens are spent first (see the usage worker), so a
 * user who converts balance never burns their free daily tokens.
 */
export async function assertWithinQuota(deps: AppDeps, userId: string): Promise<void> {
  const state = await readQuotaState(deps, userId);
  const allowanceAvailable = state.allowanceTokens > 0;

  if (state.requestsToday >= state.requestsPerDay && !allowanceAvailable) {
    throw new GatewayError(
      "quota_exceeded",
      429,
      `daily request quota exceeded (${state.requestsPerDay}) — watch an ad or top up to keep going`,
    );
  }
  if (state.tokensToday >= state.tokensPerDay && !allowanceAvailable) {
    throw new GatewayError(
      "quota_exceeded",
      429,
      `daily token quota exceeded (${state.tokensPerDay}) — watch an ad or top up to keep going`,
    );
  }
}
