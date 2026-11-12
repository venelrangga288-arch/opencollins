"use client";

import { useEffect, useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

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
          <h1 className="text-2xl font-semibold tracking-tight">Usage &amp; Analytics</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Token consumption, cost estimates, and per-model breakdown.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {error && <div className="mt-6 text-sm text-amber-600">Unable to load: {error}</div>}

      {summary && (
        <div className="mt-8 space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Requests" value={summary.totals.requests.toLocaleString()} />
            <Stat label="Total tokens" value={summary.totals.totalTokens.toLocaleString()} />
            <Stat
              label="Estimated cost"
              value={
                summary.totals.estimatedCostUsd !== null
                  ? `$${summary.totals.estimatedCostUsd.toFixed(4)}`
                  : "unpriced"
              }
            />
          </div>

          <section>
            <h2 className="text-sm font-semibold">By model</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Requests</th>
                  <th className="py-2 pr-4">Tokens</th>
                  <th className="py-2">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byModel.map((m) => (
                  <tr key={m.model} className="border-b border-neutral-100 dark:border-neutral-800/50">
                    <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                    <td className="py-2 pr-4 tabular-nums">{m.requests}</td>
                    <td className="py-2 pr-4 tabular-nums">{m.totalTokens.toLocaleString()}</td>
                    <td className="py-2 tabular-nums">
                      {m.estimatedCostUsd !== null ? `$${m.estimatedCostUsd.toFixed(4)}` : "—"}
                    </td>
                  </tr>
                ))}
                {summary.byModel.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-neutral-500">No usage in this period.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
