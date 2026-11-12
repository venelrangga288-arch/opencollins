/**
 * Provider adapter interface.
 *
 * OpenAgentic is the first implementation, but the gateway must be able to
 * add providers without rewriting routing/metering. The adapter owns:
 *  - listing models (verified only — no invented model ids)
 *  - non-streaming chat completion
 *  - streaming chat completion (SSE passthrough + usage capture)
 *  - usage extraction (delegates to @dgtlz/core)
 */
import type { ProviderUsage } from "@dgtlz/core";

export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Any other [OI]-compatible passthrough fields. */
  extra?: Record<string, unknown>;
}

export interface ChatResult {
  httpStatus: number;
  body: unknown; // provider-compatible JSON body
  latencyMs: number;
}

export interface StreamEvent {
  /** Raw SSE line to forward to the client. */
  data: string;
}

export interface StreamResult {
  httpStatus: number;
  latencyMs: number;
  /** Async iterator of SSE data payloads (already `data: ` unwrapped). */
  events: AsyncIterable<StreamEvent>;
  /** Resolves after the stream ends with usage if the provider reported it. */
  usage: Promise<ProviderUsage | null>;
}

export interface ProviderModel {
  id: string; // upstream model identifier
  displayName?: string;
  contextWindow?: number | null;
}

export interface ProviderAdapter {
  readonly slug: string;
  listModels(): Promise<ProviderModel[]>;
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): Promise<StreamResult>;
  /** Health probe used by admin provider monitoring. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}
