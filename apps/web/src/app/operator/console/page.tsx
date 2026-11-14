"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
  usageQuota: { requestsPerDay: number; tokensPerDay: number } | null;
  _count?: { apiKeys: number; agents: number };
}
interface KeyRow { id: string; name: string; prefix: string; status: string; requestCount: number; lastUsedAt: string | null; user: { email: string }; userId: string }
interface ReqRow { id: string; model: string; status: string; httpStatus: number; latencyMs: number; createdAt: string; user: { email: string } }
interface AuditRow { id: string; action: string; target: string | null; createdAt: string }
interface UsageUser { userId: string; email: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }
interface UsageModel { model: string; requests: number; totalTokens: number }

const TABS = ["Overview", "Users", "API Keys", "Usage", "Test Chat", "Agents", "Requests", "Audit"] as const;
type Tab = (typeof TABS)[number];

const TAB_GLYPH: Record<Tab, string> = {
  Overview: "◧", Users: "◇", "API Keys": "⚿", Usage: "◫",
  "Test Chat": "▷", Agents: "◈", Requests: "⇄", Audit: "⌗",
};

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
      <div className="flex min-h-screen items-center justify-center bg-obsidian-950 font-mono text-xs text-haze-haze">
        redirecting to login…
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
    <div className="flex h-screen overflow-hidden bg-obsidian-950 text-haze-bright">
      {/* ── Rail ────────────────────────────────────────── */}
      <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-obsidian-600/40 bg-obsidian-900 py-3">
        <div className="rail-btn rail-on font-display text-sm font-extrabold text-white">D</div>
        <div className="mx-2 my-1 h-px bg-obsidian-600/50" />
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            title={t}
            className={`rail-btn ${tab === t ? "rail-on" : ""}`}
          >
            {TAB_GLYPH[t]}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={logout} className="rail-btn" title="Logout">
          ⏻
        </button>
      </div>

      {/* ── Sidebar ─────────────────────────────────────── */}
      <div className="hidden w-56 shrink-0 flex-col border-r border-obsidian-600/40 bg-obsidian-850 md:flex">
        <div className="px-4 py-4">
          <div className="font-display text-sm font-bold text-haze-white">
            DGT.LZ <span className="text-glint">Operator</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-haze-haze">full control · console</div>
        </div>
        <div className="px-4 pb-2 font-mono text-[10px] uppercase tracking-widest text-haze-haze">
          Console
        </div>
        <nav className="space-y-0.5 px-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`side-btn ${tab === t ? "bg-obsidian-700 text-white" : ""}`}
            >
              <span className="w-4 text-center text-haze-haze">{TAB_GLYPH[t]}</span>
              {t}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 p-3">
          <div className="card p-3">
            <div className="stat-label">Upstream</div>
            <UpstreamDot token={token} />
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <main className="ide-scroll flex-1 overflow-y-auto">
        {/* tab bar */}
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-obsidian-600/40 bg-obsidian-950/95 px-4 py-2 backdrop-blur">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tab ${tab === t ? "tab-on" : ""}`}
            >
              {t}
            </button>
          ))}
          <div className="flex-1" />
          {notice && (
            <div
              className={`rounded-md px-3 py-1.5 font-mono text-[11px] ${
                notice.startsWith("ERROR") ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {notice}
            </div>
          )}
        </div>

        <div className="mx-auto max-w-5xl px-6 py-6">
          {tab === "Overview" && (
            <>
              {stats.error && <div className="text-[13px] text-amber-300">Failed to load: {stats.error}</div>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <Card label="Users" value={stats.data?.users} />
                <Card label="Active keys" value={stats.data?.activeKeys} />
                <Card label="Requests 24h" value={stats.data?.requests24h} />
                <Card label="Errors 24h" value={stats.data?.errors24h} />
                <Card label="Avg latency" value={stats.data ? `${stats.data.avgLatencyMs} ms` : undefined} />
                <Card label="Tokens 24h" value={stats.data?.tokens24h?.toLocaleString()} />
              </div>
              <ProviderHealthCard token={token} />
            </>
          )}

          {tab === "Users" && <UsersTab token={token} users={users} onToggle={toggleUser} />}

          {tab === "API Keys" && (
            <KeysTab
              token={token}
              keys={keys}
              users={users}
              onRevoke={revokeKey}
              onCreated={(k) => { setCreatedKey(k); keys.reload(); }}
              createdKey={createdKey}
              clearCreated={() => setCreatedKey(null)}
            />
          )}

          {tab === "Usage" && <UsageTab usage={usage} />}

          {tab === "Test Chat" && (
            <TestChatTab token={token} models={models.data?.data?.map((m) => m.id) ?? []} />
          )}

          {tab === "Agents" && (
            <OperatorAgentsTab token={token} users={users.data?.data ?? []} models={models.data?.data?.map((m) => m.id) ?? []} />
          )}

          {tab === "Requests" && (
            <Table
              headers={["Time", "User", "Model", "Status", "HTTP", "Latency"]}
              rows={reqs.data?.data ?? []}
              render={(r: ReqRow) => [
                new Date(r.createdAt).toLocaleTimeString(),
                r.user?.email ?? "—",
                <span key={`m${r.id}`} className="font-mono text-xs text-glint">{r.model}</span>,
                <Badge key={r.id} value={r.status} />,
                r.httpStatus,
                `${r.latencyMs} ms`,
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
        </div>
      </main>
    </div>
  );
}

function UpstreamDot({ token }: { token: string }) {
  const [health, setHealth] = useState<{ provider: string; ok?: boolean; latencyMs?: number; error?: string } | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/operator/provider/health`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ provider: "unknown", error: "unreachable" }));
  }, [token]);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          health?.ok ? "bg-emerald-400" : health === null ? "bg-obsidian-400" : "bg-red-400"
        }`}
      />
      <span className="font-mono text-[11px] text-haze-lite">{health?.provider ?? "…"}</span>
      {health?.latencyMs !== undefined && (
        <span className="font-mono text-[10px] text-haze-haze">{health.latencyMs}ms</span>
      )}
    </div>
  );
}

function ProviderHealthCard({ token }: { token: string }) {
  const [health, setHealth] = useState<{ provider: string; ok?: boolean; latencyMs?: number; error?: string } | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/operator/provider/health`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ provider: "unknown", error: "unreachable" }));
  }, [token]);
  return (
    <div className="card mt-6 p-4">
      <div className="stat-label">Upstream provider</div>
      <div className="mt-3 flex items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            health?.ok ? "bg-emerald-400" : health === null ? "bg-obsidian-400" : "bg-red-400"
          }`}
        />
        <span className="text-[13px] text-haze-white">{health?.provider ?? "loading…"}</span>
        {health?.latencyMs !== undefined && (
          <span className="font-mono text-[11px] text-haze-haze">{health.latencyMs} ms</span>
        )}
        {health?.error && <span className="font-mono text-[11px] text-red-400">{health.error}</span>}
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
  const [manage, setManage] = useState<UserRow | null>(null);

  return (
    <>
      <div className="card p-4">
        <div className="font-display text-sm font-bold text-haze-white">Create user</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" className="input-dark w-56" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="input-dark w-44" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8)" type="password" className="input-dark w-44" />
          <label className="flex items-center gap-2 font-mono text-[11px] text-haze-haze">
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
            className="btn-white disabled:opacity-40"
          >
            Create user
          </button>
        </div>
      </div>
      <div className="mt-5">
        <Table
          headers={["Email", "Name", "Role", "Status", "Quota / day", "Keys", "Created", ""]}
          rows={users.data?.data ?? []}
          render={(u: UserRow) => [
            <span key={`e${u.id}`} className="text-haze-white">{u.email}</span>,
            u.name ?? "—",
            <span key={`r${u.id}`} className="font-mono text-xs text-glint">{u.role}</span>,
            <Badge key={u.id} value={u.status} />,
            <span key={`q${u.id}`} className="font-mono text-[11px] text-haze-lite">
              {u.usageQuota
                ? `${u.usageQuota.requestsPerDay.toLocaleString()} req · ${(u.usageQuota.tokensPerDay / 1000).toLocaleString()}k tok`
                : "default"}
            </span>,
            u._count?.apiKeys ?? 0,
            new Date(u.createdAt).toLocaleDateString(),
            <div key={`a${u.id}`} className="flex gap-3">
              <button onClick={() => setManage(u)} className="text-xs text-glint hover:underline">Manage</button>
              <button
                onClick={() => onToggle(u.id, u.status)}
                className={u.status === "ACTIVE" ? "text-xs text-red-400 hover:underline" : "text-xs text-emerald-400 hover:underline"}
              >
                {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
              </button>
            </div>,
          ]}
        />
      </div>

      {manage && (
        <UserManageModal
          token={token}
          user={manage}
          onClose={() => setManage(null)}
          onSaved={() => { users.reload(); setManage(null); }}
        />
      )}
    </>
  );
}

function UserManageModal({ token, user, onClose, onSaved }: {
  token: string;
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [requests, setRequests] = useState(String(user.usageQuota?.requestsPerDay ?? 1000));
  const [tokens, setTokens] = useState(String(user.usageQuota?.tokensPerDay ?? 1_000_000));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md bg-obsidian-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display text-sm font-bold text-haze-white">Manage user</div>
          <button onClick={onClose} className="text-haze-haze hover:text-white">✕</button>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-glint">{user.email}</div>

        <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-haze-haze">Daily quota</div>
        <div className="mt-2 flex gap-2">
          <input value={requests} onChange={(e) => setRequests(e.target.value)} className="input-dark w-1/2" placeholder="requests/day" />
          <input value={tokens} onChange={(e) => setTokens(e.target.value)} className="input-dark w-1/2" placeholder="tokens/day" />
        </div>
        <button
          onClick={async () => {
            setErr(null); setMsg(null); setBusy(true);
            try {
              await opFetch(token, `/api/v1/operator/users/${user.id}/quota`, "PATCH", {
                requestsPerDay: Number(requests), tokensPerDay: Number(tokens),
              });
              setMsg("Quota updated.");
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}
          disabled={busy}
          className="btn-white mt-2 disabled:opacity-40"
        >
          Save quota
        </button>

        <div className="mt-5 font-mono text-[10px] uppercase tracking-widest text-haze-haze">Reset password</div>
        <div className="mt-2 flex gap-2">
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="new password (min 8)" className="input-dark flex-1" />
          <button
            onClick={async () => {
              setErr(null); setMsg(null); setBusy(true);
              try {
                await opFetch(token, `/api/v1/operator/users/${user.id}/password`, "PATCH", { password });
                setPassword("");
                setMsg("Password reset — user sessions revoked.");
              } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
            }}
            disabled={busy || password.length < 8}
            className="btn-ghost disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        {msg && <div className="mt-3 text-[12px] text-emerald-300">{msg}</div>}
        {err && <div className="mt-3 text-[12px] text-red-400">{err}</div>}

        <div className="mt-5 flex justify-end">
          <button onClick={onSaved} className="btn-ghost">Done</button>
        </div>
      </div>
    </div>
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
        <div className="mb-5 max-w-2xl rounded-lg border border-glint/50 bg-glint/5 p-4">
          <div className="text-[13px] font-semibold text-glint">Copy this key now — shown only once:</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="inline-code flex-1 break-all">{createdKey}</code>
            <button onClick={() => navigator.clipboard.writeText(createdKey)} className="btn-white">Copy</button>
            <button onClick={clearCreated} className="text-xs text-haze-haze hover:text-white">✕</button>
          </div>
        </div>
      )}
      <div className="card p-4">
        <div className="font-display text-sm font-bold text-haze-white">Create API key for a user</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input-dark w-60">
            <option value="">— select user —</option>
            {(users.data?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
          <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name" className="input-dark w-48" />
          <button
            onClick={async () => {
              try {
                const res = await opFetch(token, "/api/v1/operator/users/keys", "POST", { userId, name: keyName });
                onCreated(res.key);
                setKeyName("");
              } catch (e) { alert((e as Error).message); }
            }}
            disabled={!userId || !keyName}
            className="btn-white disabled:opacity-40"
          >
            Create key
          </button>
        </div>
      </div>
      <div className="mt-5">
        <Table
          headers={["Owner", "Name", "Key", "Status", "Requests", "Last used", ""]}
          rows={keys.data?.data ?? []}
          render={(k: KeyRow) => [
            k.user?.email ?? "—",
            <span key={`n${k.id}`} className="text-haze-white">{k.name}</span>,
            <code key={k.id} className="font-mono text-xs text-haze-haze">{k.prefix}…</code>,
            <Badge key={`s${k.id}`} value={k.status} />,
            k.requestCount,
            k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never",
            k.status === "ACTIVE" ? (
              <button key={`b${k.id}`} onClick={() => onRevoke(k.id)} className="text-xs text-red-400 hover:underline">Revoke</button>
            ) : "",
          ]}
        />
      </div>
    </>
  );
}

function UsageTab({ usage }: { usage: ReturnType<typeof useApi<{ byUser: UsageUser[]; byModel: UsageModel[]; days: number }>> }) {
  return (
    <>
      <div className="stat-label mb-3">Per user — last {usage.data?.days ?? 7} days</div>
      <Table
        headers={["Email", "Requests", "Input tokens", "Output tokens", "Total tokens"]}
        rows={usage.data?.byUser ?? []}
        render={(u: UsageUser) => [
          u.email,
          u.requests,
          u.inputTokens.toLocaleString(),
          u.outputTokens.toLocaleString(),
          <span key={`t${u.userId}`} className="text-glint">{u.totalTokens.toLocaleString()}</span>,
        ]}
      />
      <div className="stat-label mb-3 mt-8">Per model</div>
      <Table
        headers={["Model", "Requests", "Total tokens"]}
        rows={usage.data?.byModel ?? []}
        render={(m: UsageModel) => [
          <span key={`m${m.model}`} className="font-mono text-xs text-glint">{m.model || "—"}</span>,
          m.requests,
          m.totalTokens.toLocaleString(),
        ]}
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
      <div className="card p-4">
        <div className="font-display text-sm font-bold text-haze-white">
          Live test chat <span className="font-sans font-normal text-haze-haze">(bypasses keys &amp; quota)</span>
        </div>
        <div className="mt-3 space-y-3">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-full">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="input-dark w-full resize-none font-mono text-[13px]" />
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
            className="btn-white disabled:opacity-40"
          >
            {busy ? (
              <>
                <span className="spin" /> Testing…
              </>
            ) : (
              <>Send test ▸</>
            )}
          </button>
        </div>
      </div>
      {err && <div className="mt-4 text-[13px] text-red-400">{err}</div>}
      {result && (
        <div className="card mt-4 p-4">
          <div className="font-mono text-[10px] text-haze-haze">
            HTTP {result.httpStatus} · {result.latencyMs} ms · {JSON.stringify(result.usage)}
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-[13px] text-haze-bright">{result.content ?? "(empty)"}</pre>
        </div>
      )}
    </div>
  );
}

interface OpAgent {
  id: string;
  name: string;
  model: string;
  status: string;
  runBy: string;
  totalTokens: number;
  error: string | null;
  createdAt: string;
  user: { email: string };
  steps: Array<{ index: number; status: string; tokens: number }>;
}

function OperatorAgentsTab({ token, users, models }: { token: string; users: UserRow[]; models: string[] }) {
  const [agents, setAgents] = useState<OpAgent[] | null>(null);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("glm-5.3-flash");
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${GATEWAY_URL}/api/v1/operator/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setAgents(j.data))
      .catch((e) => setErr(e.message));
  }, [token]);

  const hasRunning = useRef(false);
  useEffect(() => {
    hasRunning.current = !!agents?.some((a) => a.status === "RUNNING" || a.status === "QUEUED");
  }, [agents]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (hasRunning.current && document.visibilityState === "visible") load();
    }, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function deploy() {
    setErr(null);
    setNotice(null);
    const list = prompts.map((p) => p.trim()).filter(Boolean);
    if (!userId || !name.trim() || list.length === 0) {
      setErr("user, agent name and at least one prompt required");
      return;
    }
    setBusy(true);
    try {
      const res = await opFetch(token, "/api/v1/operator/agents/deploy", "POST", {
        userId, name: name.trim(), model, prompts: list,
      });
      setNotice(`Agent "${res.agent.name}" deployed for user — running.`);
      setName("");
      setPrompts([""]);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await opFetch(token, `/api/v1/operator/agents/${id}/cancel`, "POST");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="card p-4">
        <div className="font-display text-sm font-bold text-haze-white">Deploy agent for a user</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input-dark w-56">
            <option value="">— select user —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" className="input-dark w-44" />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-48">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={deploy} disabled={busy} className="btn-white disabled:opacity-40">
            {busy ? "Deploying…" : "Deploy agent"}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {prompts.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2.5 font-mono text-[11px] text-haze-haze">{String(i + 1).padStart(2, "0")}</span>
              <textarea
                value={p}
                onChange={(e) => setPrompts(prompts.map((x, j) => (j === i ? e.target.value : x)))}
                rows={2}
                placeholder={`Step ${i + 1} prompt…`}
                className="input-dark flex-1 resize-none font-mono text-[12px]"
              />
              {prompts.length > 1 && (
                <button onClick={() => setPrompts(prompts.filter((_, j) => j !== i))} className="mt-1.5 text-haze-haze hover:text-red-400">✕</button>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => setPrompts([...prompts, ""])} disabled={prompts.length >= 20} className="btn-ghost mt-2 disabled:opacity-40">
          + Add step
        </button>
      </div>

      {notice && <div className="mt-4 rounded-md bg-emerald-500/10 px-4 py-2 text-[13px] text-emerald-300">{notice}</div>}
      {err && <div className="mt-4 text-[13px] text-red-400">{err}</div>}

      <div className="stat-label mb-3 mt-6">All agents — last 100</div>
      <Table
        headers={["Agent", "Owner", "Model", "Status", "Run by", "Steps", "Tokens", "Created", ""]}
        rows={agents ?? []}
        render={(a: OpAgent) => [
          <span key={`n${a.id}`} className="text-haze-white">{a.name}</span>,
          a.user?.email ?? "—",
          <span key={`m${a.id}`} className="font-mono text-xs text-glint">{a.model}</span>,
          <Badge key={`s${a.id}`} value={a.status} />,
          a.runBy,
          `${a.steps?.filter((s) => s.status === "COMPLETED").length ?? 0}/${a.steps?.length ?? 0}`,
          a.totalTokens.toLocaleString(),
          new Date(a.createdAt).toLocaleString(),
          (a.status === "RUNNING" || a.status === "QUEUED") ? (
            <button key={`c${a.id}`} onClick={() => cancel(a.id)} className="text-xs text-red-400 hover:underline">Cancel</button>
          ) : "",
        ]}
      />
      {agents?.length === 0 && <div className="card mt-4 p-8 text-center text-haze-haze">No agents deployed yet.</div>}
    </>
  );
}

function Card({ label, value }: { label: string; value?: number | string }) {  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? "—"}</div>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const color =
    value === "ACTIVE" || value === "SUCCESS"
      ? "bg-emerald-500/15 text-emerald-400"
      : value === "SUSPENDED" || value === "REVOKED" || value === "FAILED"
        ? "bg-red-500/15 text-red-400"
        : "bg-obsidian-600 text-haze-haze";
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>
      {value}
    </span>
  );
}

function Table<T>({ headers, rows, render }: {
  headers: string[]; rows: T[]; render: (row: T) => React.ReactNode[];
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="tbl-head">
            {headers.map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="tbl-row">
              {render(row).map((cell, i) => <td key={i} className="px-4 py-2.5">{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-haze-haze">No data.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
