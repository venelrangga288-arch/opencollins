/**
 * OpenAgentic adapter.
 *
 * CONFIGURATION IS THE SOURCE OF TRUTH:
 *  - base URL and API key come from env (UPSTREAM_BASE_URL / UPSTREAM_API_KEY)
 *  - model list is fetched from the provider, never hardcoded here
 *  - endpoint paths follow OpenAgentic's documented API
 *
 * If credentials are absent, construction fails — use MockAdapter for tests.
 */
import {
  extractUsage,
  extractUsageFromStream,
  GatewayError,
  type ProviderUsage,
} from "@dgtlz/core";
import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ProviderModel,
  StreamEvent,
  StreamResult,
} from "./types.js";

export interface OpenAgenticConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

const CHAT_PATH = "/chat/completions"; // appended to configured base URL
const MODELS_PATH = "/models";

export class OpenAgenticAdapter implements ProviderAdapter {
  readonly slug = "openagentic";

  constructor(private cfg: OpenAgenticConfig) {
    if (!cfg.baseUrl || !cfg.apiKey) {
      throw new Error(
        "OpenAgenticAdapter requires UPSTREAM_BASE_URL and UPSTREAM_API_KEY. Use MockAdapter when credentials are unavailable.",
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const res = await fetch(`${this.cfg.baseUrl}${MODELS_PATH}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!res.ok) {
      throw new GatewayError("provider_error", 502, `models list failed: HTTP ${res.status}`, res.status);
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .filter((m): m is { id: string } => typeof m.id === "string")
      .map((m) => ({ id: m.id }));
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    // Upstream occasionally 502s even on the stream path (cooldown). Retry a
    // few times with short backoff before surfacing the failure.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.chatOnce(req);
      } catch (e) {
        lastError = e;
        const isRetryable =
          e instanceof GatewayError &&
          (e.httpStatus === 502 || e.httpStatus === 503 || e.httpStatus === 429);
        if (!isRetryable || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async chatOnce(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();

    // Upstream's NON-STREAMING path is unreliable (~70% HTTP 502 "no available
    // provider"), while its STREAMING path is stable. So we always request a
    // stream from upstream and aggregate it into a complete chat.completion
    // JSON ourselves. The client still receives a normal non-stream response.
    const streamResult = await this.stream(req);
    const chunks: Array<Record<string, unknown>> = [];
    for await (const ev of streamResult.events) {
      try {
        chunks.push(JSON.parse(ev.data));
      } catch {
        /* [DONE] or non-JSON — skip */
      }
    }
    const latencyMs = Date.now() - started;

    if (chunks.length === 0) {
      throw new GatewayError("provider_error", 502, "upstream returned no stream chunks");
    }

    // Aggregate chunk deltas into a full chat.completion.
    let content = "";
    let reasoning = "";
    let role = "assistant";
    let finishReason: string | null = null;
    let model: string | null = null;
    let id: string | null = null;
    let created: number | null = null;
    let usage: Record<string, unknown> | undefined;

    for (const c of chunks) {
      const ch = c as {
        id?: string; created?: number; model?: string;
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string; role?: string }; finish_reason?: string | null }>;
        usage?: Record<string, unknown>;
      };
      if (ch.id) id = ch.id;
      if (ch.created) created = ch.created;
      if (ch.model) model = ch.model;
      if (ch.usage) usage = ch.usage;
      const choice = ch.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.role) role = choice.delta.role;
      if (choice.delta?.content) content += choice.delta.content;
      if (choice.delta?.reasoning_content) reasoning += choice.delta.reasoning_content;
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const message: Record<string, unknown> = { role, content };
    if (reasoning) message.reasoning_content = reasoning;

    const body = {
      id: id ?? `dgtlz-agg-${Date.now()}`,
      object: "chat.completion",
      created: created ?? Math.floor(Date.now() / 1000),
      model: model ?? req.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason ?? "stop",
        },
      ],
      ...(usage && { usage }),
    };

    return { httpStatus: 200, body, latencyMs };
  }

  async stream(req: ChatRequest): Promise<StreamResult> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${CHAT_PATH}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          stream_options: { include_usage: true }, // request usage in final chunk
          ...(req.temperature !== undefined && { temperature: req.temperature }),
          ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
          ...req.extra,
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new GatewayError("provider_timeout", 504, "upstream provider timed out");
      }
      throw new GatewayError("provider_error", 502, "failed to reach upstream provider");
    }

    if (!res.ok || !res.body) {
      const latencyMs = Date.now() - started;
      const detail = await res.text().catch(() => "");
      throw new GatewayError("provider_error", 502, `upstream stream failed: HTTP ${res.status} ${detail.slice(0, 200)}`, res.status);
    }

    // Collect chunks in the background for usage extraction. IMPORTANT:
    // iterate over a tee'd branch — res.body can only have ONE reader.
    const [bodyForClient, bodyForUsage] = res.body.tee();
    const latencyMs = Date.now() - started;
    const decoder = new TextDecoder();

    async function* events(): AsyncGenerator<StreamEvent> {
      const reader = bodyForClient.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              yield { data: trimmed.slice(5).trim() };
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    // Collect all chunks in the background to extract final usage, without
    // blocking the client stream itself.
    const collected: unknown[] = [];
    const usagePromise: Promise<ProviderUsage | null> = (async () => {
      const reader = bodyForUsage.getReader();
      const decoder2 = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder2.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              try {
                collected.push(JSON.parse(trimmed.slice(5).trim()));
              } catch {
                /* non-JSON chunk (e.g. [DONE]) — ignore */
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      const { usage, source } = extractUsageFromStream(collected);
      return source === "provider" ? usage : null;
    })();

    return { httpStatus: res.status, latencyMs, events: events(), usage: usagePromise };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}${MODELS_PATH}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "unknown" };
    }
  }
}

// Re-export for the usage pipeline
export { extractUsage };
