"use client";

import { useEffect, useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4101";

function useOperatorToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(localStorage.getItem("dgtlz_operator_token"));
  }, []);
  return token;
}

function useApi<T>(token: string | null, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    fetch(`${GATEWAY_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (r.status === 401) {
          localStorage.removeItem("dgtlz_operator_token");
          window.location.href = "/operator";
          throw new Error("session expired");
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token, path]);
  return { data, error };
}

interface Stats {
  users: number; activeKeys: number; requests24h: number; errors24h: number;
  avgLatencyMs: number; tokens24h: number;
}
interface UserRow { id: string; email: string; name: string | null; role: string; status: string; createdAt: string }
interface KeyRow { id: string; name: string; prefix: string; status: string; requestCount: number; lastUsedAt: string | null; user: { email: string } }
interface ReqRow { id: string; model: string; status: string; httpStatus: number; latencyMs: number; createdAt: string; user: { email: string } }
interface AuditRow { id: string; action: string; target: string | null; createdAt: string }

const TABS = ["Overview", "Users", "API Keys", "Requests", "Audit"] as const;

export default function OperatorConsolePage() {
  const token = useOperatorToken();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const stats = useApi<Stats>(token, "/api/v1/operator/stats");
  const users = useApi<{ data: UserRow[] }>(token, "/api/v1/operator/users");
  const keys = useApi<{ data: KeyRow[] }>(token, "/api/v1/operator/keys");
  const reqs = useApi<{ data: ReqRow[] }>(token, "/api/v1/operator/requests");
  const audit = useApi<{ data: AuditRow[] }>(token, "/api/v1/operator/audit-logs");

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Redirecting to login…
      </div>
    );
  }

  async function toggleUser(id: string, current: string) {
    const next = current === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await fetch(`${GATEWAY_URL}/api/v1/operator/users/${id}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    window.location.reload();
  }

  async function revokeKey(id: string) {
    await fetch(`${GATEWAY_URL}/api/v1/operator/keys/${id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    window.location.reload();
  }

  function logout() {
    localStorage.removeItem("dgtlz_operator_token");
    window.location.href = "/operator";
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <div className="text-sm font-semibold">
          DGT.LZ <span className="text-blue-500">Operator Console</span>
        </div>
        <button onClick={logout} className="text-xs text-neutral-400 hover:text-red-400">Logout</button>
      </header>

      <nav className="flex gap-1 border-b border-neutral-800 px-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              tab === t
                ? "border-b-2 border-blue-500 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === "Overview" && (
          <>
            {stats.error && <div className="text-sm text-amber-500">Failed to load: {stats.error}</div>}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <Card label="Users" value={stats.data?.users} />
              <Card label="Active keys" value={stats.data?.activeKeys} />
              <Card label="Requests 24h" value={stats.data?.requests24h} />
              <Card label="Errors 24h" value={stats.data?.errors24h} />
              <Card label="Avg latency" value={stats.data ? `${stats.data.avgLatencyMs} ms` : undefined} />
              <Card label="Tokens 24h" value={stats.data?.tokens24h?.toLocaleString()} />
            </div>
          </>
        )}

        {tab === "Users" && (
          <Table
            headers={["Email", "Name", "Role", "Status", "Created", ""]}
            rows={users.data?.data ?? []}
            render={(u: UserRow) => [
              u.email, u.name ?? "—", u.role,
              <Badge key={u.id} value={u.status} />,
              new Date(u.createdAt).toLocaleDateString(),
              <button
                key={u.id}
                onClick={() => toggleUser(u.id, u.status)}
                className={u.status === "ACTIVE" ? "text-xs text-red-400 hover:underline" : "text-xs text-green-400 hover:underline"}
              >
                {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
              </button>,
            ]}
          />
        )}

        {tab === "API Keys" && (
          <Table
            headers={["Owner", "Name", "Key", "Status", "Requests", "Last used", ""]}
            rows={keys.data?.data ?? []}
            render={(k: KeyRow) => [
              k.user?.email ?? "—", k.name,
              <code key={k.id} className="font-mono text-xs text-neutral-400">{k.prefix}…</code>,
              <Badge key={k.id} value={k.status} />,
              k.requestCount,
              k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never",
              k.status === "ACTIVE" ? (
                <button key={k.id} onClick={() => revokeKey(k.id)} className="text-xs text-red-400 hover:underline">Revoke</button>
              ) : "",
            ]}
          />
        )}

        {tab === "Requests" && (
          <Table
            headers={["Time", "User", "Model", "Status", "HTTP", "Latency"]}
            rows={reqs.data?.data ?? []}
            render={(r: ReqRow) => [
              new Date(r.createdAt).toLocaleTimeString(),
              r.user?.email ?? "—", r.model,
              <Badge key={r.id} value={r.status} />,
              r.httpStatus, `${r.latencyMs} ms`,
            ]}
          />
        )}

        {tab === "Audit" && (
          <Table
            headers={["Time", "Action", "Target"]}
            rows={audit.data?.data ?? []}
            render={(a: AuditRow) => [new Date(a.createdAt).toLocaleString(), a.action, a.target ?? "—"]}
          />
        )}
      </main>
    </div>
  );
}

function Card({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const color =
    value === "ACTIVE" || value === "SUCCESS"
      ? "bg-green-900/50 text-green-400"
      : value === "SUSPENDED" || value === "REVOKED"
        ? "bg-red-900/50 text-red-400"
        : "bg-neutral-800 text-neutral-400";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{value}</span>;
}

function Table<T>({ headers, rows, render }: {
  headers: string[]; rows: T[]; render: (row: T) => React.ReactNode[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            {headers.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(render(row)[0])} className="border-b border-neutral-800/50">
              {render(row).map((cell, i) => <td key={i} className="py-2 pr-4">{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} className="py-6 text-center text-neutral-500">No data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
