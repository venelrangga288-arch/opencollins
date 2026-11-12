# OpenAgentic Integration Notes

## Source of truth

Integration follows OpenAgentic's **actual API documentation and configuration**.
This codebase does NOT invent model names, endpoint paths, pricing, or
unsupported capabilities.

## Configuration (env)

| Variable | Purpose |
|---|---|
| `UPSTREAM_BASE_URL` | Provider base URL from OpenAgentic docs |
| `UPSTREAM_API_KEY` | Private upstream credential (server-only) |
| `UPSTREAM_TIMEOUT_MS` | Per-request timeout (default 120000) |

## Adapter contract (`packages/provider/src/types.ts`)

```
ProviderAdapter {
  slug: string
  listModels(): ProviderModel[]      // fetched live, never hardcoded
  chat(req): ChatResult              // non-streaming
  stream(req): StreamResult          // SSE passthrough + usage promise
  health(): { ok, detail? }          // admin monitoring
}
```

The gateway is provider-agnostic: routing, auth, metering, and quotas sit above
this interface. Adding a provider = new adapter class + factory entry.

## Usage metadata

- Non-streaming: usage extracted from response `usage` object
  (`prompt_tokens`/`completion_tokens` or `input_tokens`/`output_tokens`).
- Streaming: adapter requests `stream_options.include_usage`; the final chunk's
  usage is captured. If the stream dies or usage never arrives, token counts
  stay `null` — **never fabricated**.

## Missing credentials?

Without `UPSTREAM_API_KEY`, the OpenAgentic adapter refuses to start. Run with
`PROVIDER_SLUG=mock` for local development/tests (deterministic responses with
usage metadata). Real end-to-end verification requires real credentials — the
README flags this honestly.

## Pricing

`ModelPricing` rows (per 1M tokens, with effective dates) must be populated from
verified OpenAgentic pricing data. Cost = `null` / `UNPRICED` when no row applies.
