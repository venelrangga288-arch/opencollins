"use client";

import { useEffect, useState } from "react";

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
      <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Keys are stored as HMAC-SHA256 hashes. The full key is shown once at creation.
      </p>

      <div className="mt-6 flex max-w-md gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. production-backend)"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={createKey}
          disabled={!name}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Create key
        </button>
      </div>

      {createdKey && (
        <div className="mt-4 max-w-xl rounded-md border border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950">
          <div className="text-sm font-medium text-blue-800 dark:text-blue-300">
            Copy your key now — it will not be shown again.
          </div>
          <code className="mt-2 block break-all font-mono text-xs">{createdKey}</code>
        </div>
      )}

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Key</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Requests</th>
              <th className="py-2 pr-4">Last used</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-neutral-100 dark:border-neutral-800/50">
                <td className="py-2 pr-4 font-medium">{k.name}</td>
                <td className="py-2 pr-4 font-mono text-xs text-neutral-500">{k.prefix}…</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      k.status === "ACTIVE"
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    }
                  >
                    {k.status}
                  </span>
                </td>
                <td className="py-2 pr-4 tabular-nums">{k.requestCount}</td>
                <td className="py-2 pr-4 text-neutral-500">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                </td>
                <td className="py-2 text-right">
                  {k.status === "ACTIVE" && (
                    <button onClick={() => revoke(k.id)} className="text-xs text-red-600 hover:underline">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-neutral-500">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
