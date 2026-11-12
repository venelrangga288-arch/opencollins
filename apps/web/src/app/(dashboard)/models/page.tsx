"use client";

import { useEffect, useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

interface ModelInfo {
  id: string;
  display_name: string;
  context_window: number | null;
  pricing: { input_per_1m_usd: number; output_per_1m_usd: number } | null;
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/models`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => setModels(json.data))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Dynamically retrieved from the configured provider. Pricing shown only when verified —
        "—" means no verified pricing row exists (never estimated).
      </p>

      {error && <div className="mt-6 text-sm text-amber-600">Unable to load models: {error}</div>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-4">Model ID</th>
              <th className="py-2 pr-4">Context window</th>
              <th className="py-2 pr-4">Input / 1M tokens</th>
              <th className="py-2">Output / 1M tokens</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-neutral-100 dark:border-neutral-800/50">
                <td className="py-2 pr-4 font-mono text-xs">{m.id}</td>
                <td className="py-2 pr-4 tabular-nums">{m.context_window?.toLocaleString() ?? "—"}</td>
                <td className="py-2 pr-4 tabular-nums">{m.pricing ? `$${m.pricing.input_per_1m_usd}` : "—"}</td>
                <td className="py-2 tabular-nums">{m.pricing ? `$${m.pricing.output_per_1m_usd}` : "—"}</td>
              </tr>
            ))}
            {models.length === 0 && !error && (
              <tr><td colSpan={4} className="py-6 text-center text-neutral-500">No models available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
