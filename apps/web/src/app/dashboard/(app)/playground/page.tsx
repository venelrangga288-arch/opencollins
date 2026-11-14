"use client";

import { useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

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
        const ids: string[] = json.data.map((m: { id: string }) => m.id);
        setModels(ids);
        // Prefer the plan's default model; upstream returns 403 for others.
        if (ids.includes("glm-5.3-flash")) setModel("glm-5.3-flash");
        else if (ids.length > 0) setModel(ids[0]);
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
      // A 502 from the edge/tunnel returns HTML — never let that throw a parse error.
      const raw = await res.text();
      let body: { error?: { message?: string }; usage?: unknown } | null = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      if (!res.ok || !body) {
        setError(body?.error?.message ?? `HTTP ${res.status} — gateway/proxy returned no JSON`);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Playground</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Test requests through the gateway · upstream credentials never reach the browser
          </p>
        </div>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-56">
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 card p-5">
        <div className="stat-label">Prompt</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="input-dark mt-2 w-full resize-none font-mono text-[13px]"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={send}
            disabled={loading || !model}
            className="btn-white disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="spin" /> Sending…
              </>
            ) : (
              <>Send request ▸</>
            )}
          </button>
          <span className="font-mono text-[10px] text-haze-haze">@ model · / commands · enter send</span>
        </div>
      </div>

      {error && <div className="mt-5 text-[13px] text-red-400">{error}</div>}

      {result && (
        <div className="mt-5 space-y-3">
          <div className="flex gap-6 font-mono text-[11px] text-haze-haze">
            <span>
              latency <strong className="text-glint">{result.latencyMs} ms</strong>
            </span>
            <span className="truncate">usage {result.usage}</span>
          </div>
          <pre className="ide-scroll card max-h-96 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-haze-bright">
            {result.body}
          </pre>
        </div>
      )}
    </div>
  );
}
