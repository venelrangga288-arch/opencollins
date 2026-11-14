"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

interface AgentStep {
  index: number;
  status: string;
  tokens: number;
  latencyMs?: number | null;
}
interface AgentRow {
  id: string;
  name: string;
  model: string;
  status: string;
  totalTokens: number;
  error: string | null;
  createdAt: string;
  steps: AgentStep[];
}
interface AgentDetail extends AgentRow {
  steps: Array<AgentStep & { prompt: string; result: string | null; error: string | null }>;
}

const PRESET_TASKS = [
  {
    label: "Code review checklist",
    prompts: [
      "List the 10 most common bugs in TypeScript web apps (one line each).",
      "For each bug, give a one-sentence prevention tip.",
      "Summarize everything as a compact checklist a developer can paste into a PR.",
    ],
  },
  {
    label: "Landing page copy",
    prompts: [
      "Write 5 headline options for a developer API gateway product (max 8 words each).",
      "Write a 2-sentence subheading for the best headline.",
      "Write 3 short feature bullets with bold lead words.",
    ],
  },
  {
    label: "Test plan generator",
    prompts: [
      "Describe a typical REST auth flow (register, login, refresh, revoke) in 5 bullet points.",
      "Turn each bullet into 2 concrete test cases with expected results.",
      "Output the final test plan as a markdown table.",
    ],
  },
];

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    COMPLETED: "bg-emerald-500/15 text-emerald-400",
    RUNNING: "bg-glint/15 text-glint",
    QUEUED: "bg-obsidian-600 text-haze-haze",
    FAILED: "bg-red-500/15 text-red-400",
    CANCELLED: "bg-obsidian-600 text-haze-haze",
  };
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${map[value] ?? map.QUEUED}`}>
      {value}
    </span>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState("glm-5.3-flash");
  const [models, setModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${GATEWAY_URL}/api/v1/agents`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setAgents(j.data))
      .catch((e) => setError(e.message));
  }, []);

  // Poll while any agent is RUNNING. The running flag lives in a ref so this
  // effect never re-subscribes on every data update (that caused a fetch storm).
  const hasRunning = useRef(false);
  useEffect(() => {
    hasRunning.current = agents.some((a) => a.status === "RUNNING" || a.status === "QUEUED");
  }, [agents]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (hasRunning.current && document.visibilityState === "visible") load();
    }, 3000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/models`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setModels(j.data.map((m: { id: string }) => m.id)))
      .catch(() => {});
  }, []);

  async function deploy() {
    setError(null);
    setNotice(null);
    const list = prompts.map((p) => p.trim()).filter(Boolean);
    if (!name.trim() || list.length === 0) {
      setError("Agent name and at least one prompt required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/agents/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), model, prompts: list }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setNotice(`Agent "${name.trim()}" deployed — running ${list.length} step(s).`);
      setName("");
      setPrompts([""]);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    const res = await fetch(`${GATEWAY_URL}/api/v1/agents/${id}`, { credentials: "include" });
    if (res.ok) setDetail(await res.json());
  }

  async function cancel(id: string) {
    await fetch(`${GATEWAY_URL}/api/v1/agents/${id}/cancel`, { method: "POST", credentials: "include" });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Agents</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Deploy task runners — a named sequence of prompts executed through the gateway, step by step.
          </p>
        </div>
        <div className="chip">{agents.filter((a) => a.status === "RUNNING").length} running</div>
      </div>

      {/* Deploy form */}
      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name — e.g. nightly-review"
            className="input-dark w-56"
          />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-52">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={deploy} disabled={busy} className="btn-white disabled:opacity-40">
            {busy ? (
              <><span className="spin" /> Deploying…</>
            ) : (
              <>Deploy agent ▸</>
            )}
          </button>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-haze-haze">max 20 steps · sequential</span>
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
                <button
                  onClick={() => setPrompts(prompts.filter((_, j) => j !== i))}
                  className="mt-1.5 text-haze-haze hover:text-red-400"
                  title="Remove step"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPrompts([...prompts, ""])}
            disabled={prompts.length >= 20}
            className="btn-ghost disabled:opacity-40"
          >
            + Add step
          </button>
          <div className="mx-2 h-4 w-px bg-obsidian-400/60" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-haze-haze">presets:</span>
          {PRESET_TASKS.map((t) => (
            <button
              key={t.label}
              onClick={() => { setPrompts([...t.prompts]); if (!name) setName(t.label.toLowerCase().replace(/\s+/g, "-")); }}
              className="chip"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <div className="mt-4 rounded-md bg-emerald-500/10 px-4 py-2 text-[13px] text-emerald-300">{notice}</div>}
      {error && <div className="mt-4 text-[13px] text-red-400">{error}</div>}

      {/* Agent list */}
      <div className="mt-6 space-y-2">
        {agents.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => openDetail(a.id)} className="font-display text-sm font-bold text-haze-white hover:text-glint">
                {a.name}
              </button>
              <StatusBadge value={a.status} />
              <span className="font-mono text-[11px] text-glint">{a.model}</span>
              <span className="font-mono text-[11px] text-haze-haze">
                {a.steps.filter((s) => s.status === "COMPLETED").length}/{a.steps.length} steps
              </span>
              <span className="font-mono text-[11px] text-haze-haze">{a.totalTokens.toLocaleString()} tok</span>
              <div className="flex-1" />
              {(a.status === "RUNNING" || a.status === "QUEUED") && (
                <button onClick={() => cancel(a.id)} className="text-[11px] text-red-400 hover:underline">Cancel</button>
              )}
              <span className="font-mono text-[10px] text-haze-haze">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
            {/* mini step progress */}
            <div className="mt-2 flex gap-1">
              {a.steps.map((s) => (
                <div
                  key={s.index}
                  title={`step ${s.index + 1}: ${s.status}`}
                  className={`h-1 flex-1 rounded-full ${
                    s.status === "COMPLETED" ? "bg-emerald-400"
                    : s.status === "RUNNING" ? "bg-glint"
                    : s.status === "FAILED" ? "bg-red-400"
                    : "bg-obsidian-400"
                  }`}
                />
              ))}
            </div>
            {a.error && <div className="mt-2 font-mono text-[11px] text-red-400">{a.error}</div>}
          </div>
        ))}
        {agents.length === 0 && !error && (
          <div className="card p-8 text-center text-haze-haze">
            No agents yet — deploy one above or pick a preset.
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetail(null)}>
          <div className="card ide-scroll max-h-[80vh] w-full max-w-2xl overflow-y-auto bg-obsidian-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-display text-base font-bold text-haze-white">{detail.name}</div>
              <button onClick={() => setDetail(null)} className="text-haze-haze hover:text-white">✕</button>
            </div>
            <div className="mt-1 font-mono text-[11px] text-haze-haze">
              {detail.model} · <StatusBadge value={detail.status} /> · {detail.totalTokens.toLocaleString()} tokens
            </div>
            <div className="mt-4 space-y-4">
              {detail.steps.map((s) => (
                <div key={s.index} className="rounded-lg border border-obsidian-400/50 bg-obsidian-850 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-haze-haze">STEP {s.index + 1}</span>
                    <StatusBadge value={s.status} />
                    {s.latencyMs != null && <span className="font-mono text-[10px] text-haze-haze">{s.latencyMs} ms</span>}
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[12px] text-haze-lite">{s.prompt}</div>
                  {s.result && (
                    <pre className="ide-scroll mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-obsidian-400/40 bg-obsidian-900 p-3 text-[12px] leading-relaxed text-haze-bright">
                      {s.result}
                    </pre>
                  )}
                  {s.error && <div className="mt-2 text-[12px] text-red-400">{s.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
