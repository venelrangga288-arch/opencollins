"use client";

import { useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Models</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Retrieved from the configured provider · pricing shown only when verified, never estimated
          </p>
        </div>
        <div className="chip">{models.length} models</div>
      </div>

      {error && <div className="mt-6 text-[13px] text-amber-300">Unable to load models: {error}</div>}

      <div className="mt-6 card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="tbl-head">
              <th className="px-4 py-3">Model ID</th>
              <th className="px-4 py-3">Context window</th>
              <th className="px-4 py-3">Input / 1M</th>
              <th className="px-4 py-3">Output / 1M</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="tbl-row">
                <td className="px-4 py-2.5 font-mono text-xs text-glint">{m.id}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.context_window?.toLocaleString() ?? "—"}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.pricing ? `$${m.pricing.input_per_1m_usd}` : "—"}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.pricing ? `$${m.pricing.output_per_1m_usd}` : "—"}</td>
              </tr>
            ))}
            {models.length === 0 && !error && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-haze-haze">
                  No models available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
