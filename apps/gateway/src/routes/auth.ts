import { randomBytes, createHash } from "node:crypto";
import "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppDeps } from "../app.js";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const authRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { prisma, jwtSecret } = opts.deps;

  app.post("/register", async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_request", message: parsed.error.issues[0].message } });
    }
    const { email, password, name } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return reply.status(409).send({ error: { code: "invalid_request", message: "email already registered" } });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        usageQuota: {
          create: {
            requestsPerDay: opts.deps.quota.requestsPerDay,
            tokensPerDay: opts.deps.quota.tokensPerDay,
          },
        },
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await prisma.auditLog.create({
      data: { actorId: user.id, action: "user.registered", target: `user:${user.id}` },
    });

    return reply.status(201).send({ user });
  });

  app.post("/login", async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "invalid_request", message: "email and password required" } });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Constant-shape response to avoid user enumeration.
    if (!user || user.status === "SUSPENDED" || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.status(401).send({ error: { code: "invalid_request", message: "invalid credentials" } });
    }

    const token = randomBytes(32).toString("hex");
    const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? "168");
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + ttlHours * 3600_000),
      },
    });

    const jwtToken = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: `${ttlHours}h` });

    return reply
      .setCookie("dgtlz_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ttlHours * 3600,
      })
      .send({ token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  app.post("/logout", async (req, reply) => {
    const cookie = req.cookies?.["dgtlz_session"];
    if (cookie) {
      await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie) } });
    }
    return reply.clearCookie("dgtlz_session", { path: "/" }).send({ ok: true });
  });

  app.get("/me", async (req, reply) => {
    const cookie = req.cookies?.["dgtlz_session"];
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;

    if (bearer) {
      try {
        const payload = jwt.verify(bearer, jwtSecret) as { sub: string };
        userId = payload.sub;
      } catch {
        return reply.status(401).send({ error: { code: "invalid_request", message: "invalid token" } });
      }
    } else if (cookie) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(cookie) },
        select: { userId: true, expiresAt: true },
      });
      if (!session || session.expiresAt < new Date()) {
        return reply.status(401).send({ error: { code: "invalid_request", message: "session expired" } });
      }
      userId = session.userId;
    } else {
      return reply.status(401).send({ error: { code: "invalid_request", message: "not authenticated" } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    if (!user || user.status === "SUSPENDED") {
      return reply.status(401).send({ error: { code: "invalid_request", message: "account unavailable" } });
    }
    return reply.send({ user });
  });
};
