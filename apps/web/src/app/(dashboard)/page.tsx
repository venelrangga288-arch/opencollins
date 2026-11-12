"use client";

import { useEffect, useState } from "react";

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

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/usage/summary`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSummary)
      .catch((e) => setError(e.message));
  }, []);

  const stats = [
    { label: "Total requests", value: summary?.totals.requests ?? "—" },
    { label: "Total tokens", value: summary?.totals.totalTokens?.toLocaleString() ?? "—" },
    {
      label: "Estimated upstream cost",
      value: summary?.totals.estimatedCostUsd !== null && summary?.totals.estimatedCostUsd !== undefined
        ? `$${summary.totals.estimatedCostUsd.toFixed(4)}`
        : "—",
    },
    { label: "Input tokens", value: summary?.totals.inputTokens?.toLocaleString() ?? "—" },
    { label: "Output tokens", value: summary?.totals.outputTokens?.toLocaleString() ?? "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Usage across all your API keys, last 30 days.
      </p>

      {error && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Unable to load usage — {error}. Make sure you are signed in and the gateway is running.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {summary && summary.byDay.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold">Daily requests</h2>
          <div className="mt-3 flex h-40 items-end gap-1">
            {summary.byDay.map((d) => {
              const max = Math.max(...summary.byDay.map((x) => x.requests), 1);
              return (
                <div
                  key={d.day}
                  className="flex-1 rounded-t bg-blue-600/80"
                  style={{ height: `${(d.requests / max) * 100}%` }}
                  title={`${new Date(d.day).toLocaleDateString()}: ${d.requests} requests`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
