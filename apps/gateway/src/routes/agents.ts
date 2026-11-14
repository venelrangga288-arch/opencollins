/**
 * Agents API â€” /api/v1/agents
 * User-facing task runner: deploy a named sequence of prompts that the
 * gateway executes against the provider, step by step. Steps run
 * sequentially inside the request for deploy (small batches by design),
 * with live per-step status persisted so the dashboard can poll.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";
import jwt from "jsonwebtoken";

const MAX_STEPS = 20;
const MAX_PROMPT_LEN = 4000;
const MAX_RESULT_LEN = 8000; // stored truncated

/** Session auth (cookie or Bearer JWT from /auth/login). */
async function requireUser(
  prisma: AppDeps["prisma"],
  req: FastifyRequest,
  jwtSecret: string,
): Promise<{ userId: string; role: string }> {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const cookie = req.cookies?.["dgtlz_session"];
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, jwtSecret) as { sub: string; role?: string };
      return { userId: payload.sub, role: payload.role ?? "USER" };
    } catch {
      throw new GatewayError("invalid_request", 401, "invalid session");
    }
  }
  if (!cookie) throw new GatewayError("invalid_request", 401, "not authenticated");
  const { createHash } = await import("node:crypto");
  const session = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(cookie).digest("hex") },
    include: { user: { select: { id: true, role: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.status === "SUSPENDED") {
    throw new GatewayError("invalid_request", 401, "session expired");
  }
  return { userId: session.user.id, role: session.user.role };
}

const DeploySchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  prompts: z.array(z.string().min(1).max(MAX_PROMPT_LEN)).min(1).max(MAX_STEPS),
});

export const agentRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma, adapter } = opts.deps;

  /** Deploy a new agent and execute it to completion (sequential steps). */
  app.post("/deploy", async (req) => {
    const auth = await requireUser(prisma, req, opts.deps.jwtSecret);
    const parsed = DeploySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, `name, model and 1-${MAX_STEPS} prompts required`);
    }
    const { name, model, prompts } = parsed.data;

    const agent = await prisma.agent.create({
      data: {
        userId: auth.userId,
        name,
        model,
        status: "RUNNING",
        startedAt: new Date(),
        steps: {
          create: prompts.map((prompt, index) => ({ index, prompt })),
        },
      },
      include: { steps: { orderBy: { index: "asc" } } },
    });

    // Fire-and-forget execution: respond immediately with the agent id so the
    // UI can poll. Steps are executed sequentially in the background.
    void (async () => {
      let totalTokens = 0;
      let firstError: string | null = null;
      for (const step of agent.steps) {
        try {
          const result = await adapter.chat({
            model,
            messages: [{ role: "user", content: step.prompt }],
            max_tokens: 2000,
          });
          const body = result.body as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
          } | null;
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
        } catch (e) {
          const msg = e instanceof Error ? e.message : "step failed";
          if (!firstError) firstError = `step ${step.index}: ${msg}`;
          await prisma.agentStep.update({
            where: { id: step.id },
            data: { status: "FAILED", error: msg.slice(0, 500) },
          });
          break; // stop at first failing step
        }
      }
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          status: firstError ? "FAILED" : "COMPLETED",
          totalTokens,
          error: firstError,
          finishedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          actorId: auth.userId,
          action: "agent.finished",
          target: `agent:${agent.id}`,
          metadata: { name, model, steps: prompts.length, status: firstError ? "FAILED" : "COMPLETED" },
        },
      }).catch(() => {});
    })().catch(() => {});

    await prisma.auditLog.create({
      data: { actorId: auth.userId, action: "agent.deployed", target: `agent:${agent.id}`, metadata: { name, model, steps: prompts.length } },
    });

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        model: agent.model,
        status: agent.status,
        steps: agent.steps.map((s) => ({ id: s.id, index: s.index, status: s.status })),
      },
    };
  });

  /** List my agents (operator sees all with ?all=1). */
  app.get("/", async (req) => {
    const auth = await requireUser(prisma, req, opts.deps.jwtSecret);
    const url = req.query as { all?: string };
    const where = auth.role === "ADMIN" && url.all === "1" ? {} : { userId: auth.userId };
    const agents = await prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { steps: { orderBy: { index: "asc" }, select: { index: true, status: true, tokens: true, latencyMs: true } } },
    });
    return { data: agents };
  });

  /** Agent detail incl. step results. */
  app.get("/:id", async (req) => {
    const auth = await requireUser(prisma, req, opts.deps.jwtSecret);
    const { id } = req.params as { id: string };
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: { steps: { orderBy: { index: "asc" } } },
    });
    if (!agent || (agent.userId !== auth.userId && auth.role !== "ADMIN")) {
      throw new GatewayError("invalid_request", 404, "agent not found");
    }
    return agent;
  });

  /** Cancel a queued/running agent (best-effort: marks CANCELLED). */
  app.post("/:id/cancel", async (req) => {
    const auth = await requireUser(prisma, req, opts.deps.jwtSecret);
    const { id } = req.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent || (agent.userId !== auth.userId && auth.role !== "ADMIN")) {
      throw new GatewayError("invalid_request", 404, "agent not found");
    }
    if (agent.status === "COMPLETED" || agent.status === "FAILED") {
      throw new GatewayError("invalid_request", 400, "agent already finished");
    }
    await prisma.agent.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    await prisma.auditLog.create({ data: { actorId: auth.userId, action: "agent.cancelled", target: `agent:${id}` } });
    return { ok: true };
  });
};
