/**
 * Mock adapter — for tests and credential-less development ONLY.
 * Returns deterministic [OI]-compatible responses with usage metadata.
 * Never registered as a production provider.
 */
import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ProviderModel,
  StreamEvent,
  StreamResult,
} from "./types.js";

const MOCK_MODELS: ProviderModel[] = [
  { id: "mock-model-small", displayName: "Mock Small", contextWindow: 8192 },
  { id: "mock-model-large", displayName: "Mock Large", contextWindow: 32768 },
];

export class MockAdapter implements ProviderAdapter {
  readonly slug = "mock";

  async listModels(): Promise<ProviderModel[]> {
    return MOCK_MODELS;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: "chat.completion",
      model: req.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: `mock response to: ${JSON.stringify(req.messages.at(-1)?.content ?? "")}` },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 24,
        total_tokens: 36,
      },
    };
    return { httpStatus: 200, body, latencyMs: 5 };
  }

  async stream(_req: ChatRequest): Promise<StreamResult> {
    const chunks: string[] = [
      JSON.stringify({ choices: [{ delta: { role: "assistant", content: "mock " } }] }),
      JSON.stringify({ choices: [{ delta: { content: "stream response" } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      "[DONE]",
    ];

    async function* events(): AsyncGenerator<StreamEvent> {
      for (const c of chunks) yield { data: c };
    }

    const usage: Promise<import("@dgtlz/core").ProviderUsage | null> = (async () => {
      for await (const ev of events()) {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.usage) {
            return {
              inputTokens: parsed.usage.prompt_tokens ?? null,
              outputTokens: parsed.usage.completion_tokens ?? null,
              totalTokens: parsed.usage.total_tokens ?? null,
            };
          }
        } catch { /* ignore */ }
      }
      return null;
    })();

    return { httpStatus: 200, latencyMs: 3, events: events(), usage };
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
