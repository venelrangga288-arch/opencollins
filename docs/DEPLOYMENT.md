# DGT.LZ Gateway — Deployment Guide

## Topology

```
Cloudflare DNS (dgtlz.my.id)
  └─► Cloudflare Tunnel / Reverse proxy
        ├─ /*             → web (Next.js, :3000)
        └─ /api/v1/*      → gateway (Fastify, :4000)
                             └─ worker (BullMQ consumer)
  postgres (:5432 internal) · redis (:6379 internal)
```

## 1. Environment

```bash
cp .env.example .env
# Generate secrets:
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # API_KEY_HASH_SECRET
```

Fill `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY` from OpenAgentic's documented
configuration. Never commit `.env`.

## 2. Domain & HTTPS

1. Cloudflare DNS: `A`/`CNAME` record for `dgtlz.my.id` → your host (or tunnel).
2. Enable Cloudflare proxy (orange cloud) + "Full (strict)" TLS mode.
3. Origin TLS via Let's Encrypt (Caddy/Nginx) or Cloudflare Tunnel (no open ports).

### Cloudflare Tunnel

```bash
cloudflared tunnel create dgtlz
# config.yml ingress:
#   - hostname: dgtlz.my.id
#     service: http://localhost:3000     # web
#   - hostname: dgtlz.my.id
#     path: ^/api/v1/.*
#     service: http://localhost:4000     # gateway
#   - service: http_status:404
cloudflared tunnel route dns dgtlz dgtlz.my.id
cloudflared tunnel run dgtlz
```

## 3. Database migrations

```bash
npm run db:generate
npm run db:migrate        # prisma migrate deploy
```

Migrations run before first deploy; never edit applied migrations.

## 4. Production deploy

```bash
docker compose up -d --build
docker compose exec gateway npx prisma migrate deploy
```

Health checks: `GET /health` on gateway, `GET :3000` on web.

## 5. Backups & recovery

- Postgres: nightly `pg_dump` to off-site storage:
  `docker compose exec postgres pg_dump -U dgtlz dgtlz | gzip > backup-$(date +%F).sql.gz`
- Retain 30 daily + 12 monthly dumps. Test restores quarterly.
- Redis is cache/queue only — data loss degrades analytics briefly, never loses
  committed usage records queued < queue visibility timeout.

## 6. Rollback

Keep previous image tag; `docker compose down && PREVIOUS_TAG=... docker compose up -d`.
Database migrations are forward-only — roll back code, not schema, when possible.
