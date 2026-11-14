/**
 * Agents API — /api/v1/agents
 *
 * A user-facing task runner: deploy a named sequence of prompts that the
 * gateway executes against the provider, step by step. Progress is persisted
 * per step so the dashboard can poll live status.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GatewayError } from "@dgtlz/core";
import type { AppDeps } from "../app.js";
import { requireSessionUser } from "../lib/auth.js";
import { assertWithinQuota } from "../lib/quota.js";
import { runAgent } from "../services/agent-runner.js";

const MAX_STEPS = 20;
const MAX_PROMPT_LEN = 4000;

const DeploySchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  prompts: z.array(z.string().min(1).max(MAX_PROMPT_LEN)).min(1).max(MAX_STEPS),
});

export const agentRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma } = opts.deps;

  /** Deploy a new agent; execution continues in the background. */
  app.post("/deploy", async (req) => {
    const auth = await requireSessionUser(req, opts.deps);
    const parsed = DeploySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new GatewayError("invalid_request", 400, `name, model and 1-${MAX_STEPS} prompts required`);
    }
    const { name, model, prompts } = parsed.data;

    await assertWithinQuota(opts.deps, auth.userId);

    const agent = await prisma.agent.create({
      data: {
        userId: auth.userId,
        name,
        model,
        status: "RUNNING",
        startedAt: new Date(),
        steps: { create: prompts.map((prompt, index) => ({ index, prompt })) },
      },
      include: { steps: { orderBy: { index: "asc" } } },
    });

    // Fire-and-forget: respond immediately with the id so the UI can poll.
    void runAgent(opts.deps, agent.id).catch(() => {});

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: "agent.deployed",
        target: `agent:${agent.id}`,
        metadata: { name, model, steps: prompts.length },
      },
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

  /** List my agents (admins may pass ?all=1). */
  app.get("/", async (req) => {
    const auth = await requireSessionUser(req, opts.deps);
    const url = req.query as { all?: string };
    const where = auth.role === "ADMIN" && url.all === "1" ? {} : { userId: auth.userId };
    const agents = await prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        steps: { orderBy: { index: "asc" }, select: { index: true, status: true, tokens: true, latencyMs: true } },
      },
    });
    return { data: agents };
  });

  /** Agent detail including step prompts and results. */
  app.get("/:id", async (req) => {
    const auth = await requireSessionUser(req, opts.deps);
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

  /** Cancel a queued/running agent (best effort). */
  app.post("/:id/cancel", async (req) => {
    const auth = await requireSessionUser(req, opts.deps);
    const { id } = req.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent || (agent.userId !== auth.userId && auth.role !== "ADMIN")) {
      throw new GatewayError("invalid_request", 404, "agent not found");
    }
    if (agent.status === "COMPLETED" || agent.status === "FAILED") {
      throw new GatewayError("invalid_request", 400, "agent already finished");
    }
    await prisma.agent.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorId: auth.userId, action: "agent.cancelled", target: `agent:${id}` },
    });
    return { ok: true };
  });
};
