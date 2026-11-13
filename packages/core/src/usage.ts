/**
 * Usage extraction & cost calculation.
 *
 * Rules (from product spec):
 *  - Prefer actual usage metadata returned by the provider.
 *  - Never fabricate token counts — missing usage stays null.
 *  - Cost is null when no pricing row applies — billing status UNPRICED.
 */

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface Pricing {
  inputPer1M: number; // USD per 1M input tokens
  outputPer1M: number;
}

export interface ExtractedUsage {
  usage: ProviderUsage;
  source: "provider" | "none";
}

interface RawUsageShape {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
}

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/**
 * Extract usage from an OpenAI-compatible usage object.
 * Accepts both {prompt_tokens, completion_tokens} and {input_tokens, output_tokens}.
 * Returns source "none" (all null) when usage metadata is absent/invalid.
 */
export function extractUsage(responseBody: unknown): ExtractedUsage {
  const raw = (responseBody as { usage?: RawUsageShape } | null)?.usage;
  if (!raw || typeof raw !== "object") {
    return { usage: { inputTokens: null, outputTokens: null, totalTokens: null }, source: "none" };
  }
  const input = asCount(raw.prompt_tokens) ?? asCount(raw.input_tokens);
  const output = asCount(raw.completion_tokens) ?? asCount(raw.output_tokens);
  if (input === null && output === null) {
    return { usage: { inputTokens: null, outputTokens: null, totalTokens: null }, source: "none" };
  }
  let total = asCount(raw.total_tokens);
  if (total === null && input !== null && output !== null) total = input + output;
  return { usage: { inputTokens: input, outputTokens: output, totalTokens: total }, source: "provider" };
}

/**
 * Extract usage from a stream of SSE chunks. The final chunk (or the
 * `stream_options.include_usage` chunk) may carry usage; scan all and prefer
 * the last one that has it.
 */
export function extractUsageFromStream(sseChunks: unknown[]): ExtractedUsage {
  let found: ExtractedUsage = {
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    source: "none",
  };
  for (const chunk of sseChunks) {
    const parsed = (chunk as { usage?: RawUsageShape } | null)?.usage;
    if (parsed && typeof parsed === "object") {
      const input = asCount(parsed.prompt_tokens) ?? asCount(parsed.input_tokens);
      const output = asCount(parsed.completion_tokens) ?? asCount(parsed.output_tokens);
      if (input !== null || output !== null) {
        let total = asCount(parsed.total_tokens);
        if (total === null && input !== null && output !== null) total = input + output;
        found = { usage: { inputTokens: input, outputTokens: output, totalTokens: total }, source: "provider" };
      }
    }
  }
  return found;
}

export interface CostResult {
  estimatedCost: number | null; // USD
  billingStatus: "TRACKED" | "UNPRICED";
}

/**
 * Compute upstream cost. Null tokens or null pricing => null cost, UNPRICED.
 * Never estimates or fabricates.
 */
export function computeCost(usage: ProviderUsage, pricing: Pricing | null): CostResult {
  if (
    !pricing ||
    usage.inputTokens === null ||
    usage.outputTokens === null
  ) {
    return { estimatedCost: null, billingStatus: "UNPRICED" };
  }
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  return { estimatedCost: cost, billingStatus: "TRACKED" };
}
