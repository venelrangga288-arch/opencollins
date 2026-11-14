"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "@/lib/api-base";

interface Summary {
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
  };
  byDay: Array<{ day: string; requests: number; tokens: number; estimatedCostUsd: number | null }>;
}

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-widest text-haze-haze">{label}</span>
      <code className="inline-code flex-1 truncate">{value}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn-white shrink-0"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [quota, setQuota] = useState<{ quota: { requestsPerDay: number; tokensPerDay: number } | null; today: { requests: number; tokens: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/usage/summary`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSummary)
      .catch((e) => setError(e.message));

    fetch(`${GATEWAY_URL}/api/v1/usage/quota`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setQuota)
      .catch(() => {});
  }, []);

  const stats = [
    { label: "Requests", value: summary?.totals.requests ?? "—" },
    { label: "Tokens", value: summary?.totals.totalTokens?.toLocaleString() ?? "—" },
    { label: "Input tok", value: summary?.totals.inputTokens?.toLocaleString() ?? "—" },
    { label: "Output tok", value: summary?.totals.outputTokens?.toLocaleString() ?? "—" },
    {
      label: "Est. cost",
      value:
        summary?.totals.estimatedCostUsd !== null && summary?.totals.estimatedCostUsd !== undefined
          ? `$${summary.totals.estimatedCostUsd.toFixed(4)}`
          : "—",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Overview</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Usage across all your API keys · last 30 days
          </p>
        </div>
        <div className="chip">METERED</div>
      </div>

      {error && (
        <div className="mt-6 card border-amber-500/40 p-4 text-[13px] text-amber-300">
          Unable to load usage — {error}. Make sure you are signed in and the gateway is running.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {quota?.quota && (
        <div className="mt-6 card p-5">
          <div className="flex items-center justify-between">
            <div className="stat-label">Today · daily quota</div>
            <a href="/dashboard/usage" className="text-[11px] text-glint hover:underline">details ↗</a>
          </div>
          {[
            { label: "Requests", used: quota.today.requests, cap: quota.quota.requestsPerDay },
            { label: "Tokens", used: quota.today.tokens, cap: quota.quota.tokensPerDay },
          ].map((q) => {
            const pct = Math.min(100, Math.round((q.used / Math.max(q.cap, 1)) * 100));
            return (
              <div key={q.label} className="mt-3">
                <div className="flex items-baseline justify-between font-mono text-[11px] text-haze-haze">
                  <span>{q.label}</span>
                  <span>
                    {q.used.toLocaleString()} / {q.cap.toLocaleString()} ({pct}%)
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-obsidian-600">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-glint"}`}
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {summary && summary.byDay.length > 0 && (
        <div className="mt-8 card p-5">
          <div className="stat-label">Tokens per day</div>
          <div className="mt-4 flex h-36 items-end gap-1.5">
            {summary.byDay.map((d) => {
              const max = Math.max(...summary.byDay.map((x) => x.tokens ?? x.requests), 1);
              const v = d.tokens ?? d.requests;
              return (
                <div
                  key={d.day}
                  className="flex-1 rounded-t bg-glint/70 transition-colors hover:bg-glint"
                  style={{ height: `${Math.max((v / max) * 100, 2)}%` }}
                  title={`${new Date(d.day).toLocaleDateString()}: ${d.requests} requests · ${d.tokens?.toLocaleString() ?? 0} tokens`}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {[
          { href: "/dashboard/keys", title: "1 · Create an API key", body: "Keys are shown once. Use them from any OpenAI-compatible SDK." },
          { href: "/dashboard/playground", title: "2 · Try a request", body: "Send a prompt through the gateway and inspect the raw response." },
          { href: "/dashboard/agents", title: "3 · Deploy an agent", body: "Run a multi-step task chain and watch each step finish." },
        ].map((s) => (
          <a key={s.href} href={s.href} className="card p-4 transition-colors hover:border-glint/50">
            <div className="font-display text-[13px] font-bold text-haze-white">{s.title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-haze-haze">{s.body}</div>
          </a>
        ))}
      </div>

      <div className="mt-8 card p-5">
        <div className="flex items-center justify-between">
          <div className="font-display text-sm font-bold text-haze-white">API Access</div>
          <div className="chip">openai-compatible</div>
        </div>
        <p className="mt-1 text-xs text-haze-haze">
          Point any [OI]-compatible SDK here. Get your <span className="inline-code">dgtlz_live_…</span> key on the API Keys page.
        </p>
        <div className="mt-4">
          <CopyField label="Base URL" value={apiBaseUrl()} />
        </div>
        <pre className="ide-scroll mt-4 overflow-x-auto rounded-lg border border-obsidian-400/60 bg-obsidian-900 p-4 font-mono text-[12px] leading-relaxed text-haze-bright">
{`curl ${apiBaseUrl()}/chat/completions \\
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hello!"}]}'`}
        </pre>
      </div>
    </div>
  );
}
