/**
 * Agent runner — executes an agent's steps sequentially against the provider.
 *
 * Each step is a single chat completion. Results, tokens and latency are
 * persisted per step so the dashboard can show live progress, and every step
 * enqueues a usage job so agent traffic is metered exactly like API traffic.
 */
import type { AppDeps } from "../app.js";

const MAX_RESULT_LEN = 8000;

export async function runAgent(deps: AppDeps, agentId: string): Promise<void> {
  const { prisma, adapter, usageQueue } = deps;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!agent) return;

  let totalTokens = 0;
  let firstError: string | null = null;

  for (const step of agent.steps) {
    // Stop early when the operator/user cancelled the run.
    const current = await prisma.agent.findUnique({ where: { id: agentId }, select: { status: true } });
    if (current?.status === "CANCELLED") return;

    const startedAt = Date.now();
    try {
      const result = await adapter.chat({
        model: agent.model,
        messages: [{ role: "user", content: step.prompt }],
        max_tokens: 2000,
      });

      const body = result.body as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      } | null;

      if (result.httpStatus >= 400) {
        throw new Error(`provider returned HTTP ${result.httpStatus}`);
      }

      const content = body?.choices?.[0]?.message?.content ?? "";
      const tokens = body?.usage?.total_tokens ?? 0;
      totalTokens += tokens;

      await prisma.agentStep.update({
        where: { id: step.id },
        data: {
          status: "COMPLETED",
          result: content.slice(0, MAX_RESULT_LEN),
          tokens,
          latencyMs: result.latencyMs,
        },
      });

      // Meter the step so quota + usage dashboards stay truthful.
      await usageQueue.add("record", {
        requestId: `agent-step-${step.id}`,
        userId: agent.userId,
        apiKeyId: null,
        providerSlug: adapter.slug,
        model: agent.model,
        endpoint: "/agents/step",
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        responseBody: body,
        usage: {
          inputTokens: body?.usage?.prompt_tokens ?? null,
          outputTokens: body?.usage?.completion_tokens ?? null,
          totalTokens: body?.usage?.total_tokens ?? null,
        },
      }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "step failed";
      if (!firstError) firstError = `step ${step.index + 1}: ${msg}`;
      await prisma.agentStep.update({
        where: { id: step.id },
        data: {
          status: "FAILED",
          error: msg.slice(0, 500),
          latencyMs: Date.now() - startedAt,
        },
      });
      break; // stop at the first failing step
    }
  }

  const latest = await prisma.agent.findUnique({ where: { id: agentId }, select: { status: true } });
  if (latest?.status === "CANCELLED") return;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      status: firstError ? "FAILED" : "COMPLETED",
      totalTokens,
      error: firstError,
      finishedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: agent.userId,
      action: "agent.finished",
      target: `agent:${agentId}`,
      metadata: { name: agent.name, model: agent.model, steps: agent.steps.length, status: firstError ? "FAILED" : "COMPLETED" },
    },
  }).catch(() => {});
}
