"use client";

import { useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

export default function DashboardLoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Only allow same-site relative redirects. */
  function nextTarget(): string {
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  }

  // Already signed in? Skip the form.
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/auth/me`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.user) window.location.replace(nextTarget());
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(mode === "login" ? { email, password } : { email, password, name: name || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      // register returns 201 {user}; auto-login right after
      if (mode === "register") {
        const l = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });
        if (!l.ok) {
          setError("Account created — please sign in.");
          setMode("login");
          return;
        }
      }
      window.location.href = nextTarget();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-obsidian-950 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="font-display text-lg font-extrabold text-haze-white">
            DGT.LZ <span className="text-glint">Gateway</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-haze-haze">
            {mode === "login" ? "sign in to your workstation" : "create your account"}
          </div>
        </div>

        {/* mode tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-obsidian-400 bg-obsidian-800 p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              className={`rounded-md py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                mode === m ? "bg-obsidian-600 text-haze-white" : "text-haze-haze hover:text-haze-lite"
              }`}
            >
              {m === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        {mode === "register" && (
          <>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-haze-haze">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional"
              className="input-dark mt-1.5 w-full"
            />
          </>
        )}
        <label className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-haze-haze">Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          className="input-dark mt-1.5 w-full"
          autoFocus
        />
        <label className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-haze-haze">
          Password {mode === "register" && <span className="normal-case tracking-normal">(min 8 chars)</span>}
        </label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          className="input-dark mt-1.5 w-full"
        />
        {error && <div className="mt-4 text-[13px] text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={loading || !email || !password}
          className="btn-white mt-6 w-full justify-center disabled:opacity-40"
        >
          {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <div className="mt-4 text-center font-mono text-[10px] text-haze-haze">
          keys &amp; usage are per-account · quotas apply
        </div>
        <div className="mt-3 text-center">
          <a href="/collins" className="text-[11px] text-haze-haze hover:text-glint">
            ← back to landing
          </a>
        </div>
      </form>
    </div>
  );
}
