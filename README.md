# Collins / DGT.LZ Gateway

AI API gateway + usage platform. Developers get their own keys
(`dgtlz_live_...`), the gateway forwards to the upstream model provider, meters
every token, and the dashboard shows exactly what was used and what it cost.

Two surfaces ship in this repo:

- **Collins** — the landing page (`/collins`) and the workstation shell
  (`/collins/workstation.html`), including the "watch ads → earn rupiah →
  convert to tokens" reward dashboard.
- **App** — the signed-in console: overview, playground, agents, keys, usage,
  models, docs, plus an operator console at `/operator`.

```
Developer ──► Gateway (/api/v1)
                │  1. authenticate: API key OR dashboard session
                │  2. rate limit (Redis) + quota / allowance check
                │  3. resolve model + pricing
                │  4. forward to upstream provider
                │  5. extract usage (including streaming)
                │  6. enqueue async usage logging (BullMQ)
                └─► provider-compatible response
```

## Stack

| Layer | Tech |
|---|---|
| Dashboard | Next.js 15, TypeScript, Tailwind |
| Gateway | Fastify, TypeScript, Zod |
| Data | PostgreSQL + Prisma, Redis |
| Jobs | BullMQ (usage logging worker) |
| Tests | Vitest |
| Deploy | PM2 + Cloudflare Tunnel (any VPS works) |

## Layout

```
apps/
  web/       Next.js dashboard, Collins landing + workstation
  gateway/   Fastify public API (/api/v1) + worker
packages/
  db/        Prisma schema, client, migrations
  core/      key generation + HMAC hashing, usage extraction, cost calc
  provider/  provider adapter interface, upstream + mock adapters
scripts/     ad creative prep, end-to-end credit verification
```

## Quick start

```bash
# prerequisites: Node 20+, Docker
docker compose up -d postgres redis
npm install
npm run db:migrate
npm run dev            # web on :3100, gateway on :4101
```

1. Open `http://localhost:3100` → register
2. Create an API key (shown once)
3. Call the gateway:

```bash
curl http://localhost:4101/api/v1/chat/completions \
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL","messages":[{"role":"user","content":"hi"}]}'
```

## Environment

Copy `.env.example` → `.env`. **Never commit `.env`.**

Upstream credentials are required for real traffic (`UPSTREAM_BASE_URL`,
`UPSTREAM_API_KEY`); without them the gateway can run against the mock provider
for tests only. No model, pricing or token figure in this repo is invented —
anything unverified is stored as `null` and surfaced as `UNPRICED`.

## Ads → balance → tokens

The reward economy is server-authoritative; nothing about a payout is decided
in the browser.

| Piece | Behaviour |
|---|---|
| `AdCreative` | 15 house creatives (Mixkit free clips, re-encoded to 7s). Per-creative reward range, operator-editable. |
| `POST /credits/ads/session` | Issues one slot: creative, a random reward inside the range, an HMAC nonce bound to user + session, and a deadline. |
| `POST /credits/ads/complete` | Pays out only if the reported watch time reaches `minWatchPercent` of the clip, the nonce matches, the session is unexpired and unused, and the daily caps still have room. Idempotent — replaying cannot double-pay. |
| `POST /credits/convert` | Turns rupiah balance into allowance tokens at `tokensPerRupiah`, enforcing a minimum and a weekly token cap. |
| `CreditLedgerEntry` | Append-only. Every movement stores `balanceAfter`, so the newest row *is* the balance and the table is the audit trail. |

Allowance tokens are spent **before** the free daily quota, which is what makes
earned balance actually usable against real API traffic
(`BillingStatus.ALLOWANCE`).

Rewards pay **Rp 700–5.000** per completed ad, 15 ads/day, conversion unlocks at
Rp 10.000. Every number above is a `CreditConfig` row the operator can change at
runtime from `/operator` — no redeploy.

Regenerate the creatives (downloads + trims + writes `manifest.json`):

```bash
node scripts/prepare-ad-creatives.mjs    # needs ffmpeg on PATH
npx tsx apps/gateway/src/seed-ads.ts     # idempotent upsert into Postgres
```

## End-to-end verification

```bash
node scripts/verify-credits.mjs
```

Walks the whole money path against a running gateway: login → issue ad →
prove a short watch is **not** rewarded → prove a full watch **is** → prove a
replay does not double-pay → prove the conversion minimum holds → operator
grant → convert → allowance visible on the quota.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | web + gateway concurrently |
| `npm run build` | build all apps/packages |
| `npm test` | vitest suite (57 tests) |
| `npm run typecheck` | tsc across the workspace |
| `npm run db:migrate` | `prisma migrate deploy` |

## Docs

- `docs/API.md` — public gateway API reference
- `docs/DEPLOYMENT.md` — domain, Cloudflare, HTTPS, migrations, backups
- `docs/SECURITY.md` — key hashing, RBAC, audit logging

## License

Private.
