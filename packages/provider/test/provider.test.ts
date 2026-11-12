import { describe, it, expect } from "vitest";
import { MockAdapter } from "../src/mock.js";
import { extractUsage, GatewayError } from "@dgtlz/core";

describe("MockAdapter", () => {
  const adapter = new MockAdapter();

  it("lists a fixed set of models", async () => {
    const models = await adapter.listModels();
    expect(models.map((m) => m.id)).toEqual(["mock-model-small", "mock-model-large"]);
  });

  it("returns [OI]-compatible chat completion with usage", async () => {
    const res = await adapter.chat({
      model: "mock-model-small",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(res.httpStatus).toBe(200);
    const body = res.body as { usage?: Record<string, number>; choices?: unknown[] };
    expect(body.choices).toHaveLength(1);
    const { usage, source } = extractUsage(body);
    expect(source).toBe("provider");
    expect(usage.totalTokens).toBe(36);
  });

  it("streams SSE chunks ending with usage", async () => {
    const res = await adapter.stream({ model: "mock-model-small", messages: [] });
    const events: string[] = [];
    for await (const ev of res.events) events.push(ev.data);
    expect(events.at(-1)).toBe("[DONE]");
    const usage = await res.usage;
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  it("health reports ok", async () => {
    expect((await adapter.health()).ok).toBe(true);
  });
});

describe("OpenAgenticAdapter construction", () => {
  it("refuses construction without credentials", async () => {
    const { OpenAgenticAdapter } = await import("../src/openagentic.js");
    expect(() => new OpenAgenticAdapter({ baseUrl: "", apiKey: "", timeoutMs: 1000 })).toThrow();
  });
});

describe("GatewayError mapping", () => {
  it("exposes code + status", () => {
    const e = new GatewayError("rate_limited", 429, "slow down");
    expect(e.code).toBe("rate_limited");
    expect(e.httpStatus).toBe(429);
  });
});
