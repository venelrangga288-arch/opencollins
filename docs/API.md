# DGT.LZ Gateway — Public API Reference

Base: `https://dgtlz.my.id/api/v1` (dev: `http://localhost:4000/api/v1`)

All data-plane endpoints require `Authorization: Bearer dgtlz_live_...`.
Errors use the envelope `{ "error": { "code", "message", "request_id" } }`.

## POST /chat/completions

[OI]-compatible request:

```json
{
  "model": "MODEL_ID",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 512
}
```

- Non-streaming → provider JSON response verbatim + `x-request-id` header.
- `"stream": true` → `text/event-stream` SSE, ends with `data: [DONE]`.

Error codes: `missing_api_key`, `invalid_api_key`, `key_revoked`, `rate_limited`,
`quota_exceeded`, `model_not_found`, `invalid_request`, `provider_error`,
`provider_timeout`.

## GET /models

List of provider models. `pricing: null` = unverified (never fabricated).

## GET /usage?page=1&pageSize=25&since=ISO&until=ISO

Paginated usage records (tokens may be `null` when provider omitted metadata).

## GET /usage/summary?since=ISO&until=ISO

Totals, per-model breakdown, per-day time series. `estimatedCostUsd: null` when
unpriced.

## Dashboard endpoints (session/JWT auth)

- `POST /auth/register` — email, password (min 8), name
- `POST /auth/login` — sets httpOnly session cookie, returns JWT
- `POST /auth/logout`, `GET /auth/me`
- `GET/POST /keys`, `DELETE /keys/:id` — full key returned exactly once

## Admin (JWT with role=ADMIN)

- `GET /admin/users`, `PATCH /admin/users/:id/status`
- `GET /admin/keys`, `POST /admin/keys/:id/revoke`
- `GET /admin/requests`, `GET /admin/provider/health`, `GET /admin/audit-logs`
