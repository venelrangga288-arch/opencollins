# DGT.LZ Gateway — AI API Gateway & Usage Management Platform

> Domain: `dgtlz.my.id` · API Base: `https://dgtlz.my.id/api/v1`

DGT.LZ Gateway is an intermediary AI API gateway. Developers authenticate with
DGT.LZ-issued API keys (`dgtlz_live_...`) instead of upstream provider
credentials. The gateway forwards requests to the upstream provider (OpenAgentic),
meters token usage, computes costs, and exposes analytics via a dashboard.

```
Developer ──► DGT.LZ Gateway (/api/v1)
                 │  1. verify API key (hash lookup)
                 │  2. rate limit + quota check (Redis)
                 │  3. resolve model + pricing
                 │  4. forward to upstream provider
                 │  5. extract usage metadata (incl. streaming)
                 │  6. enqueue async usage logging (BullMQ)
                 └─► provider-compatible response back to developer
```

## Stack

| Layer          | Tech                                        |
|----------------|---------------------------------------------|
| Dashboard      | Next.js 15 + TypeScript + Tailwind + shadcn/ui + Recharts |
| Gateway API    | Fastify + TypeScript + Zod                  |
| Database       | PostgreSQL + Prisma                         |
| Cache/Ratelimit| Redis                                       |
| Background jobs| BullMQ (usage logging worker)               |
| Testing        | Vitest (mocked provider)                    |
| Deployment     | Docker Compose (web, gateway, worker, postgres, redis) |

## Repository layout

```
apps/
  web/        Next.js dashboard + admin
  gateway/    Fastify public API (/api/v1)
packages/
  db/         Prisma schema + client
  core/       key generation, hashing, usage extraction, cost calc
  provider/   provider adapter interface + OpenAgentic adapter + mock
```

## Quick start (local)

```bash
# prerequisites: Node 20+, Docker
docker compose up -d postgres redis
npm install
npm run db:migrate
npm run dev          # web on :3000, gateway on :4000
```

1. Register at `http://localhost:3000`
2. Create an API key (shown once, `dgtlz_live_...`)
3. Call the gateway:

```bash
curl http://localhost:4000/api/v1/chat/completions \
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL","messages":[{"role":"user","content":"hi"}]}'
```

## Environment

Copy `.env.example` → `.env` and fill in values. **Never commit `.env`.**

Required upstream credentials (documented, not invented — see
`docs/OPENAGENTIC_INTEGRATION.md`):

- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`

> ⚠️ **Integration status:** real upstream calls require the credentials above.
> Without them, the gateway runs with the `mock` provider for tests only.

## Scripts

| Command            | Purpose                          |
|--------------------|----------------------------------|
| `npm run dev`      | web + gateway concurrently       |
| `npm run build`    | build all apps/packages          |
| `npm test`         | vitest suite                     |
| `npm run typecheck`| tsc across workspace             |
| `npm run db:migrate` | prisma migrate deploy          |

## Docs

- `docs/API.md` — public gateway API reference
- `docs/DEPLOYMENT.md` — domain, Cloudflare, HTTPS, migrations, backups
- `docs/OPENAGENTIC_INTEGRATION.md` — upstream provider integration notes
- `docs/SECURITY.md` — key hashing, RBAC, audit logging

## License

Private.
