"use client";

import { useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

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
    <div className="flex min-h-screen items-center justify-center bg-obsidian-950 px-4">
      <form onSubmit={login} className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="font-display text-lg font-extrabold text-haze-white">
            DGT.LZ <span className="text-glint">Operator</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-haze-haze">
            restricted console access
          </div>
        </div>
        <label className="block font-mono text-[10px] uppercase tracking-widest text-haze-haze">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="input-dark mt-1.5 w-full"
          autoFocus
        />
        <label className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-haze-haze">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-dark mt-1.5 w-full"
        />
        {error && <div className="mt-4 text-[13px] text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={loading || !username || !password}
          className="btn-white mt-6 w-full justify-center disabled:opacity-40"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
