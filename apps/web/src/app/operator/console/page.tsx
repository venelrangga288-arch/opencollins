"use client";

import { useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

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
  const [loading, setLoading] = useState(false);
  const reload = () => {
    if (!token) return;
    setLoading(true);
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
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [token, path]);
  return { data, error, loading, reload };
}

async function opFetch(token: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json;
}

interface Stats {
  users: number; activeKeys: number; requests24h: number; errors24h: number;
  avgLatencyMs: number; tokens24h: number;
}
interface UserRow { id: string; email: string; name: string | null; role: string; status: string; createdAt: string }
interface KeyRow { id: string; name: string; prefix: string; status: string; requestCount: number; lastUsedAt: string | null; user: { email: string }; userId: string }
interface ReqRow { id: string; model: string; status: string; httpStatus: number; latencyMs: number; createdAt: string; user: { email: string } }
interface AuditRow { id: string; action: string; target: string | null; createdAt: string }
interface UsageUser { userId: string; email: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }
interface UsageModel { model: string; requests: number; totalTokens: number }

const TABS = ["Overview", "Users", "API Keys", "Usage", "Test Chat", "Requests", "Audit"] as const;
type Tab = (typeof TABS)[number];

export default function OperatorConsolePage() {
  const token = useOperatorToken();
  const [tab, setTab] = useState<Tab>("Overview");
  const stats = useApi<Stats>(token, "/api/v1/operator/stats");
  const users = useApi<{ data: UserRow[] }>(token, "/api/v1/operator/users");
  const keys = useApi<{ data: KeyRow[] }>(token, "/api/v1/operator/keys");
  const reqs = useApi<{ data: ReqRow[] }>(token, "/api/v1/operator/requests");
  const audit = useApi<{ data: AuditRow[] }>(token, "/api/v1/operator/audit-logs");
  const usage = useApi<{ byUser: UsageUser[]; byModel: UsageModel[]; days: number }>(token, "/api/v1/operator/usage?days=7");
  const models = useApi<{ data: Array<{ id: string }> }>(token, "/api/v1/operator/models");

  const [notice, setNotice] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Redirecting to login…
      </div>
    );
  }

  async function run(fn: () => Promise<void>, okMsg: string) {
    try {
      await fn();
      setNotice(okMsg);
      setTimeout(() => setNotice(null), 3000);
      users.reload(); keys.reload(); stats.reload(); audit.reload(); usage.reload();
    } catch (e) {
      setNotice(`ERROR: ${(e as Error).message}`);
      setTimeout(() => setNotice(null), 5000);
    }
  }

  async function toggleUser(id: string, current: string) {
    await run(async () => {
      await opFetch(token!, `/api/v1/operator/users/${id}/status`, "PATCH", {
        status: current === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      });
    }, "User status updated");
  }

  async function revokeKey(id: string) {
    await run(async () => {
      await opFetch(token!, `/api/v1/operator/keys/${id}/revoke`, "POST");
    }, "Key revoked");
  }

  async function logout() {
    localStorage.removeItem("dgtlz_operator_token");
    window.location.href = "/operator";
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <div className="text-sm font-semibold">
          DGT.LZ <span className="text-blue-500">Operator Console</span> — full control
        </div>
        <button onClick={logout} className="text-xs text-neutral-400 hover:text-red-400">Logout</button>
      </header>

      {notice && (
        <div className={`mx-6 mt-3 rounded-md px-4 py-2 text-sm ${notice.startsWith("ERROR") ? "bg-red-950 text-red-300" : "bg-green-950 text-green-300"}`}>
          {notice}
        </div>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-neutral-800 px-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              tab === t ? "border-b-2 border-blue-500 text-white" : "text-neutral-500 hover:text-neutral-300"
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
            <ProviderHealth token={token} />
          </>
        )}

        {tab === "Users" && (
          <UsersTab token={token} users={users} onToggle={toggleUser} />
        )}

        {tab === "API Keys" && (
          <KeysTab token={token} keys={keys} users={users} onRevoke={revokeKey} onCreated={(k) => { setCreatedKey(k); keys.reload(); }} createdKey={createdKey} clearCreated={() => setCreatedKey(null)} />
        )}

        {tab === "Usage" && (
          <UsageTab usage={usage} />
        )}

        {tab === "Test Chat" && (
          <TestChatTab token={token} models={models.data?.data?.map((m) => m.id) ?? []} />
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

function ProviderHealth({ token }: { token: string }) {
  const [health, setHealth] = useState<{ provider: string; ok?: boolean; latencyMs?: number; error?: string } | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/operator/provider/health`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ provider: "unknown", error: "unreachable" }));
  }, [token]);
  return (
    <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">Upstream provider</div>
      <div className="mt-2 flex items-center gap-3">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${health?.ok ? "bg-green-500" : health === null ? "bg-neutral-600" : "bg-red-500"}`} />
        <span className="text-sm">{health?.provider ?? "loading…"}</span>
        {health?.latencyMs !== undefined && <span className="text-xs text-neutral-500">{health.latencyMs} ms</span>}
        {health?.error && <span className="text-xs text-red-400">{health.error}</span>}
      </div>
    </div>
  );
}

function UsersTab({ token, users, onToggle }: {
  token: string;
  users: ReturnType<typeof useApi<{ data: UserRow[] }>>;
  onToggle: (id: string, current: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);

  return (
    <>
      <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold">Create user</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" className="w-56 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="w-44 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8)" type="password" className="w-44 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} /> as ADMIN
          </label>
          <button
            onClick={async () => {
              try {
                await opFetch(token, "/api/v1/operator/users", "POST", {
                  email, password, name: name || undefined, role: asAdmin ? "ADMIN" : undefined,
                });
                setEmail(""); setPassword(""); setName(""); setAsAdmin(false);
                users.reload();
              } catch (e) { alert((e as Error).message); }
            }}
            disabled={!email || password.length < 8}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            Create user
          </button>
        </div>
      </div>
      <Table
        headers={["Email", "Name", "Role", "Status", "Created", ""]}
        rows={users.data?.data ?? []}
        render={(u: UserRow) => [
          u.email, u.name ?? "—", u.role,
          <Badge key={u.id} value={u.status} />,
          new Date(u.createdAt).toLocaleDateString(),
          <button
            key={u.id}
            onClick={() => onToggle(u.id, u.status)}
            className={u.status === "ACTIVE" ? "text-xs text-red-400 hover:underline" : "text-xs text-green-400 hover:underline"}
          >
            {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
          </button>,
        ]}
      />
    </>
  );
}

function KeysTab({ token, keys, users, onRevoke, onCreated, createdKey, clearCreated }: {
  token: string;
  keys: ReturnType<typeof useApi<{ data: KeyRow[] }>>;
  users: ReturnType<typeof useApi<{ data: UserRow[] }>>;
  onRevoke: (id: string) => Promise<void>;
  onCreated: (key: string) => void;
  createdKey: string | null;
  clearCreated: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [keyName, setKeyName] = useState("");

  return (
    <>
      {createdKey && (
        <div className="mb-6 max-w-2xl rounded-md border border-blue-500 bg-blue-950 p-4">
          <div className="text-sm font-medium text-blue-300">Copy this key now — shown only once:</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-blue-800 bg-neutral-900 px-2 py-1.5 font-mono text-xs">{createdKey}</code>
            <button
              onClick={() => navigator.clipboard.writeText(createdKey)}
              className="rounded border border-neutral-600 px-3 py-1.5 text-xs hover:bg-neutral-800"
            >Copy</button>
            <button onClick={clearCreated} className="text-xs text-neutral-500 hover:text-neutral-300">✕</button>
          </div>
        </div>
      )}
      <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold">Create API key for a user</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-60 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm">
            <option value="">— select user —</option>
            {(users.data?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
          <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name" className="w-48 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm" />
          <button
            onClick={async () => {
              try {
                const res = await opFetch(token, "/api/v1/operator/users/keys", "POST", { userId, name: keyName });
                onCreated(res.key);
                setKeyName("");
              } catch (e) { alert((e as Error).message); }
            }}
            disabled={!userId || !keyName}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            Create key
          </button>
        </div>
      </div>
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
            <button key={k.id} onClick={() => onRevoke(k.id)} className="text-xs text-red-400 hover:underline">Revoke</button>
          ) : "",
        ]}
      />
    </>
  );
}

function UsageTab({ usage }: { usage: ReturnType<typeof useApi<{ byUser: UsageUser[]; byModel: UsageModel[]; days: number }>> }) {
  return (
    <>
      <h3 className="mb-3 text-sm font-semibold">Per user — last {usage.data?.days ?? 7} days</h3>
      <Table
        headers={["Email", "Requests", "Input tokens", "Output tokens", "Total tokens"]}
        rows={usage.data?.byUser ?? []}
        render={(u: UsageUser) => [u.email, u.requests, u.inputTokens.toLocaleString(), u.outputTokens.toLocaleString(), u.totalTokens.toLocaleString()]}
      />
      <h3 className="mb-3 mt-8 text-sm font-semibold">Per model</h3>
      <Table
        headers={["Model", "Requests", "Total tokens"]}
        rows={usage.data?.byModel ?? []}
        render={(m: UsageModel) => [m.model, m.requests, m.totalTokens.toLocaleString()]}
      />
    </>
  );
}

function TestChatTab({ token, models }: { token: string; models: string[] }) {
  const [model, setModel] = useState("glm-5.3-flash");
  const [prompt, setPrompt] = useState("Say exactly: OPERATOR TEST OK");
  const [result, setResult] = useState<{ content: string | null; latencyMs: number; httpStatus: number; usage: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="max-w-2xl">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold">Live test chat (bypasses keys &amp; quota)</h3>
        <div className="mt-3 space-y-3">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm" />
          <button
            onClick={async () => {
              setBusy(true); setErr(null); setResult(null);
              try {
                const r = await opFetch(token, "/api/v1/operator/test-chat", "POST", { model, prompt });
                setResult(r);
              } catch (e) { setErr((e as Error).message); }
              setBusy(false);
            }}
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? "Testing…" : "Send test"}
          </button>
        </div>
      </div>
      {err && <div className="mt-4 text-sm text-red-400">{err}</div>}
      {result && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-xs text-neutral-500">HTTP {result.httpStatus} · {result.latencyMs} ms · usage: {JSON.stringify(result.usage)}</div>
          <pre className="mt-2 whitespace-pre-wrap text-sm">{result.content ?? "(empty)"}</pre>
        </div>
      )}
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
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-neutral-800/50">
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
