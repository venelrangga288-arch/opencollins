"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "@/lib/api-base";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

interface KeyRecord {
  id: string;
  name: string;
  prefix: string;
  status: string;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}

function StatusBadge({ value }: { value: string }) {
  const on = value === "ACTIVE";
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
        on ? "bg-emerald-500/15 text-emerald-400" : "bg-obsidian-600 text-haze-haze"
      }`}
    >
      {value}
    </span>
  );
}

export default function KeysPage() {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`${GATEWAY_URL}/api/v1/keys`, { credentials: "include" });
    if (res.ok) setKeys((await res.json()).data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function createKey() {
    setError(null);
    const res = await fetch(`${GATEWAY_URL}/api/v1/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const json = await res.json();
      setCreatedKey(json.key); // shown exactly once
      setName("");
      load();
    } else {
      setError(`create failed: HTTP ${res.status}`);
    }
  }

  async function revoke(id: string) {
    await fetch(`${GATEWAY_URL}/api/v1/keys/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">API Keys</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Keys are stored as HMAC-SHA256 hashes · full key shown once at creation
          </p>
        </div>
        <div className="chip">{keys.filter((k) => k.status === "ACTIVE").length} active</div>
      </div>

      {/* Base URL strip */}
      <div className="mt-5 card flex flex-wrap items-center gap-3 p-4">
        <span className="stat-label">Base URL</span>
        <code className="inline-code">{apiBaseUrl()}</code>
        <CopyButton value={apiBaseUrl()} />
        <a
          href={`${apiBaseUrl()}/models`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-glint hover:underline"
        >
          List models ↗
        </a>
      </div>

      {/* Create */}
      <div className="mt-5 flex max-w-xl gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name — e.g. production-backend"
          className="input-dark flex-1"
        />
        <button
          onClick={createKey}
          disabled={!name}
          className="btn-white disabled:opacity-40"
        >
          Create key
        </button>
      </div>

      {createdKey && (
        <div className="mt-5 max-w-xl rounded-lg border border-glint/50 bg-glint/5 p-4">
          <div className="text-[13px] font-semibold text-glint">
            Copy your key now — it will not be shown again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="inline-code flex-1 break-all">{createdKey}</code>
            <CopyButton value={createdKey} />
          </div>
          <p className="mt-2 font-mono text-[10px] text-haze-haze">
            use with base url: <span className="text-glint">{apiBaseUrl()}</span>
          </p>
        </div>
      )}

      {error && <div className="mt-5 text-[13px] text-red-400">{error}</div>}

      <div className="mt-6 card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="tbl-head">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Last used</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="tbl-row">
                <td className="px-4 py-2.5 font-medium text-haze-white">{k.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-haze-haze">{k.prefix}…</td>
                <td className="px-4 py-2.5">
                  <StatusBadge value={k.status} />
                </td>
                <td className="px-4 py-2.5 tabular-nums">{k.requestCount}</td>
                <td className="px-4 py-2.5 text-haze-haze">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {k.status === "ACTIVE" && (
                    <button onClick={() => revoke(k.id)} className="text-xs text-red-400 hover:underline">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-haze-haze">
                  No API keys yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
