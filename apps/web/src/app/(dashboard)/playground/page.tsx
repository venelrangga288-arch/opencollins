"use client";

import { useEffect, useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

export default function PlaygroundPage() {
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("Say hello in one sentence.");
  const [result, setResult] = useState<{ body: string; latencyMs: number; usage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/models`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        setModels(json.data.map((m: { id: string }) => m.id));
        if (json.data.length > 0) setModel(json.data[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function send() {
    setError(null);
    setLoading(true);
    setResult(null);
    const started = performance.now();
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const latencyMs = Math.round(performance.now() - started);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
      } else {
        setResult({
          body: JSON.stringify(body, null, 2),
          latencyMs,
          usage: body.usage ? JSON.stringify(body.usage) : "no usage metadata returned",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">API Playground</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Test requests through the gateway. Upstream credentials never reach the browser — the server proxies everything.
      </p>

      <div className="mt-6 max-w-xl space-y-4">
        <div>
          <label className="text-sm font-medium">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {models.length === 0 && <option value="">(sign in and ensure gateway is running)</option>}
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <button
          onClick={send}
          disabled={loading || !model}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "Sending…" : "Send request"}
        </button>
      </div>

      {error && <div className="mt-6 text-sm text-red-600">{error}</div>}

      {result && (
        <div className="mt-6 max-w-3xl space-y-3">
          <div className="flex gap-6 text-sm text-neutral-500">
            <span>Latency: <strong className="text-neutral-900 dark:text-neutral-100">{result.latencyMs} ms</strong></span>
            <span>Usage: <code className="font-mono text-xs">{result.usage}</code></span>
          </div>
          <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-900">
            {result.body}
          </pre>
        </div>
      )}
    </div>
  );
}
