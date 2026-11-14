"use client";

import { useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

interface Summary {
  totals: { requests: number; totalTokens: number; estimatedCostUsd: number | null };
  byModel: Array<{ model: string; requests: number; totalTokens: number; estimatedCostUsd: number | null }>;
  byDay: Array<{ day: string; requests: number; tokens: number; estimatedCostUsd: number | null }>;
}

export default function UsagePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    fetch(`${GATEWAY_URL}/api/v1/usage/summary?since=${since}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSummary)
      .catch((e) => setError(e.message));
  }, [days]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Usage</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Token consumption · per-model breakdown · cost estimates
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="input-dark w-36"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {error && <div className="mt-6 text-[13px] text-amber-300">Unable to load: {error}</div>}

      {summary && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <div className="stat-label">Requests</div>
              <div className="stat-value">{summary.totals.requests.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total tokens</div>
              <div className="stat-value">{summary.totals.totalTokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Est. cost</div>
              <div className="stat-value">
                {summary.totals.estimatedCostUsd !== null
                  ? `$${summary.totals.estimatedCostUsd.toFixed(4)}`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="border-b border-obsidian-400/60 px-4 py-3 font-display text-sm font-bold text-haze-white">
              By model
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="tbl-head">
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Requests</th>
                  <th className="px-4 py-3">Tokens</th>
                  <th className="px-4 py-3">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byModel.map((m) => (
                  <tr key={m.model} className="tbl-row">
                    <td className="px-4 py-2.5 font-mono text-xs text-glint">{m.model || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.requests}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.totalTokens.toLocaleString()}</td>
                    <td className="px-4 py-2.5 tabular-nums text-haze-haze">
                      {m.estimatedCostUsd !== null ? `$${m.estimatedCostUsd.toFixed(4)}` : "—"}
                    </td>
                  </tr>
                ))}
                {summary.byModel.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-haze-haze">
                      No usage in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
