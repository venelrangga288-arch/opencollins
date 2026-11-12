# DGT.LZ Gateway — Security Model

## API keys

- Format: `dgtlz_live_` + 32 base62 chars (crypto-random).
- Storage: **HMAC-SHA256(key, API_KEY_HASH_SECRET)** — a DB leak alone does not
  permit verification of guessed keys; the env secret is also required.
- Full key shown **once** at creation. Only `prefix` (first 20 chars) + hash stored.
- Verification uses `timingSafeEqual` (constant-time).
- Revocation flips `status = REVOKED`; verification rejects non-ACTIVE keys.

## Authentication

- Dashboard: session cookie (`httpOnly`, `secure` in prod, `sameSite=lax`) with
  SHA-256-hashed token in DB + JWT for API clients.
- Gateway data plane: Bearer `dgtlz_live_` keys only — sessions never accepted.
- Passwords: bcrypt cost 12.
- Login responses are constant-shape to prevent user enumeration.

## Rate limiting & quotas

- Per-user Redis counter (`INCR` + `EXPIRE`), configurable via env.
- Per-user daily quotas (requests, tokens) enforced before provider call.

## Data protection

- Upstream provider credentials exist **only** in gateway env — never sent to
  browsers, never included in API responses, never logged (pino `redact` on
  `authorization` headers, passwords, key hashes).
- Request bodies are never persisted — only metadata (usage, latency, status).
- `.env` is gitignored; `.env.example` documents all variables.

## RBAC

- `User.role ∈ {USER, ADMIN}`; all `/api/v1/admin/*` routes require `ADMIN` JWT.
- Admin suspension of a user cascades: sessions deleted, active keys revoked.

## Audit

- `AuditLog` records key creation/revocation, user registration, suspension,
  admin revocations — with actor, action, target, timestamp.

## Known limitations (honest)

- MVP has no payments; `BillingStatus` is TRACKED/UNPRICED only.
- Admin panel routes exist but the dedicated admin UI page is pending.
- Rate limiting is in-memory-Redis single-instance; multi-region needs a
  token-bucket via Lua script for atomicity.
