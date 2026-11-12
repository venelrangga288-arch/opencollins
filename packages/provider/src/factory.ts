export * from "./types.js";
export * from "./openagentic.js";
export * from "./mock.js";

import { OpenAgenticAdapter, MockAdapter, type ProviderAdapter } from "./index.js";

/** Build the active adapter from environment configuration. */
export function createAdapterFromEnv(env: {
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_API_KEY?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  PROVIDER_SLUG?: string;
}): ProviderAdapter {
  const slug = env.PROVIDER_SLUG ?? "openagentic";
  if (slug === "mock") return new MockAdapter();
  return new OpenAgenticAdapter({
    baseUrl: env.UPSTREAM_BASE_URL ?? "",
    apiKey: env.UPSTREAM_API_KEY ?? "",
    timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? "120000"),
  });
}
