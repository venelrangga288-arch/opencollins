"use client";

import { useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4101";

export default function OperatorLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/operator/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      localStorage.setItem("dgtlz_operator_token", json.token);
      window.location.href = "/operator/console";
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <form onSubmit={login} className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-white">
            DGT.LZ <span className="text-blue-500">Operator</span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">Restricted console access</div>
        </div>
        <label className="block text-sm text-neutral-400">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
          autoFocus
        />
        <label className="mt-4 block text-sm text-neutral-400">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
        {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={loading || !username || !password}
          className="mt-6 w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
