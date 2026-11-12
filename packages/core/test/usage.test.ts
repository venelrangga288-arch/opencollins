import { describe, it, expect } from "vitest";
import { computeCost, extractUsage, extractUsageFromStream } from "../src/usage.js";

describe("extractUsage", () => {
  it("extracts prompt/completion tokens", () => {
    const r = extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
    expect(r).toEqual({
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      source: "provider",
    });
  });

  it("accepts input_tokens/output_tokens naming", () => {
    const r = extractUsage({ usage: { input_tokens: 5, output_tokens: 7 } });
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 7, totalTokens: 12 });
  });

  it("returns nulls when usage absent — never fabricates", () => {
    const r = extractUsage({ choices: [] });
    expect(r.source).toBe("none");
    expect(r.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("returns nulls for invalid usage values", () => {
    const r = extractUsage({ usage: { prompt_tokens: "many", completion_tokens: -5 } });
    expect(r.source).toBe("none");
  });
});

describe("extractUsageFromStream", () => {
  it("uses the final chunk carrying usage", () => {
    const chunks = [
      { choices: [{ delta: { content: "hi" } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 4 } },
    ];
    const r = extractUsageFromStream(chunks);
    expect(r.source).toBe("provider");
    expect(r.usage.totalTokens).toBe(7);
  });

  it("returns source none when no chunk has usage (client disconnect mid-stream)", () => {
    const r = extractUsageFromStream([{ choices: [{ delta: { content: "par" } }] }]);
    expect(r.source).toBe("none");
    expect(r.usage.inputTokens).toBeNull();
  });
});

describe("computeCost", () => {
  const pricing = { inputPer1M: 1, outputPer1M: 2 };

  it("computes cost from tokens and pricing", () => {
    const r = computeCost({ inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000 }, pricing);
    expect(r.estimatedCost).toBeCloseTo(2.0);
    expect(r.billingStatus).toBe("TRACKED");
  });

  it("returns UNPRICED when pricing missing", () => {
    const r = computeCost({ inputTokens: 100, outputTokens: 100, totalTokens: 200 }, null);
    expect(r.estimatedCost).toBeNull();
    expect(r.billingStatus).toBe("UNPRICED");
  });

  it("returns UNPRICED when tokens missing (never fabricates)", () => {
    const r = computeCost({ inputTokens: null, outputTokens: null, totalTokens: null }, pricing);
    expect(r.estimatedCost).toBeNull();
    expect(r.billingStatus).toBe("UNPRICED");
  });
});
