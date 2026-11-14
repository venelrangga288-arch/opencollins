"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

interface CreditsConfig {
  tokensPerRupiah: number;
  minConvertRupiah: number;
  dailyAdsPerUser: number;
  dailyRewardCapRupiah: number;
  weeklyTokenCap: number;
  minWatchPercent: number;
  sessionTtlSeconds: number;
  adsEnabled: boolean;
}

interface CreditsResponse {
  config: CreditsConfig;
  balance: { rupiah: number; allowanceTokens: number };
  earnings: { lifetimeRupiah: number; lifetimeTokensGranted: number; convertedRupiah: number };
  today: { adsWatched: number; adsLimit: number; earnedRupiah: number; earnLimitRupiah: number };
  week: { tokensConverted: number; tokenCap: number };
  quota: {
    requestsToday: number;
    requestsPerDay: number;
    tokensToday: number;
    tokensPerDay: number;
    allowanceTokens: number;
  };
}

interface LedgerEntry {
  id: string;
  type: "AD_REWARD" | "TOPUP" | "GRANT" | "ADJUSTMENT" | "CONVERT" | "REFUND";
  source: string;
  amountRupiah: number;
  balanceAfter: number;
  tokensGranted: number | null;
  note: string | null;
  createdAt: string;
}

interface SeriesPoint {
  day: string;
  earnedRupiah: number;
  convertedRupiah: number;
  tokensGranted: number;
  ads: number;
}

interface Series {
  days: number;
  points: SeriesPoint[];
  totals: { earnedRupiah: number; convertedRupiah: number; tokensGranted: number; ads: number };
}

interface CreativeMeta {
  id: string;
  slug: string;
  title: string;
  brand: string;
  tagline: string | null;
  posterUrl: string | null;
  accent: string;
  durationMs: number;
}

interface AdSlot {
  sessionId: string;
  nonce: string;
  creative: {
    id: string;
    slug: string;
    title: string;
    brand: string;
    tagline: string | null;
    videoUrl: string;
    posterUrl: string | null;
    accent: string;
    durationMs: number;
  };
  rewardRupiah: number;
  expiresAt: string;
  requiredWatchMs: number;
}

interface CompleteResponse {
  rewarded: boolean;
  rewardRupiah: number;
  balanceRupiah: number;
  allowanceTokens: number;
  reason?: string;
}

/* ---------------------------------------------------------------- helpers */

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number) => Math.round(n).toLocaleString("id-ID");
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  : n >= 1_000 ? `${Math.round(n / 1_000)}K`
  : `${Math.round(n)}`;

const LEDGER_LABEL: Record<LedgerEntry["type"], string> = {
  AD_REWARD: "Ad reward",
  TOPUP: "Top-up",
  GRANT: "Grant",
  ADJUSTMENT: "Adjustment",
  CONVERT: "Converted to tokens",
  REFUND: "Refund",
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ------------------------------------------------------------------ icons */

const ICON = {
  check: (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
    </svg>
  ),
  play: (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  download: (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  ),
  chevron: (
    <svg className="h-3 w-3 text-[#6f6f6a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  ),
  bolt: (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  ),
};

/* ------------------------------------------------------------ area chart */

function AreaChart({
  values,
  height = 200,
  color = "#5fbf8a",
  labels,
}: {
  values: number[];
  height?: number;
  color?: string;
  labels?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 620;
  const h = height;
  const pad = 8;
  const max = Math.max(...values, 1) * 1.1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;

  return (
    <div className="relative w-full" style={{ height: h }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * w;
          const i = Math.round((x - pad) / (step || 1));
          setHover(i >= 0 && i < values.length ? i : null);
        }}
      >
        <defs>
          <linearGradient id={`g-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={w - pad}
            y1={pad + (h - pad * 2) * f}
            y2={pad + (h - pad * 2) * f}
            stroke="#232321"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill={`url(#g-${color.replace("#", "")})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <>
            <line
              x1={pts[hover][0]}
              x2={pts[hover][0]}
              y1={pad}
              y2={h - pad}
              stroke="#333330"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="3" fill={color} />
          </>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-[#333330] bg-[#1b1b19] px-2 py-1 font-mono text-[10px] text-[#ecece8] shadow-xl"
          style={{ left: `${(pts[hover][0] / w) * 100}%`, transform: "translateX(-50%)" }}
        >
          {labels?.[hover] ?? ""} Â· {rp(values[hover])}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function EarnPage() {
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [series, setSeries] = useState<Series | null>(null);
  const [catalog, setCatalog] = useState<CreativeMeta[]>([]);
  const [range, setRange] = useState(7);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "reward" | "convert">("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const [slot, setSlot] = useState<AdSlot | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "paused" | "reward" | "failed">("idle");
  const [payout, setPayout] = useState<CompleteResponse | null>(null);
  const [watchedMs, setWatchedMs] = useState(0);
  const [interruptions, setInterruptions] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watchedRef = useRef(0);
  const interRef = useRef(0);
  const submittedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [creditsRes, ledgerRes, seriesRes, catRes] = await Promise.all([
        fetch(`${GATEWAY_URL}/api/v1/credits`, { credentials: "include" }),
        fetch(`${GATEWAY_URL}/api/v1/credits/ledger?limit=40`, { credentials: "include" }),
        fetch(`${GATEWAY_URL}/api/v1/credits/series?days=${range}`, { credentials: "include" }),
        fetch(`${GATEWAY_URL}/api/v1/credits/ads/catalog`, { credentials: "include" }),
      ]);
      if (!creditsRes.ok) throw new Error(`HTTP ${creditsRes.status}`);
      setData((await creditsRes.json()) as CreditsResponse);
      if (ledgerRes.ok) setLedger(((await ledgerRes.json()) as { entries: LedgerEntry[] }).entries ?? []);
      if (seriesRes.ok) setSeries((await seriesRes.json()) as Series);
      if (catRes.ok) setCatalog(((await catRes.json()) as { creatives: CreativeMeta[] }).creatives ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || document.hidden) return;
      watchedRef.current += 100;
      setWatchedMs(watchedRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const onHide = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        interRef.current += 1;
        setInterruptions(interRef.current);
        setPhase("paused");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase]);

  const submit = useCallback(
    async (current: AdSlot) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setBusy(true);
      try {
        const res = await fetch(`${GATEWAY_URL}/api/v1/credits/ads/complete`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: current.sessionId,
            nonce: current.nonce,
            watchedMs: Math.round(watchedRef.current),
            interruptions: interRef.current,
          }),
        });
        const body = (await res.json()) as CompleteResponse & { error?: { message?: string } };
        if (!res.ok) {
          setNotice({ kind: "warn", text: body.error?.message ?? `HTTP ${res.status}` });
          setPhase("failed");
          return;
        }
        setPayout(body);
        setPhase(body.rewarded ? "reward" : "failed");
        if (!body.rewarded && body.reason) setNotice({ kind: "warn", text: body.reason });
        await load();
      } catch (e) {
        setNotice({ kind: "warn", text: e instanceof Error ? e.message : "network error" });
        setPhase("failed");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const watchAd = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/credits/ads/session`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as AdSlot & { error?: { message?: string } };
      if (!res.ok) {
        setNotice({ kind: "warn", text: body.error?.message ?? `HTTP ${res.status}` });
        return;
      }
      watchedRef.current = 0;
      interRef.current = 0;
      submittedRef.current = false;
      setWatchedMs(0);
      setInterruptions(0);
      setPayout(null);
      setSlot(body);
      setPhase("playing");
    } catch (e) {
      setNotice({ kind: "warn", text: e instanceof Error ? e.message : "network error" });
    } finally {
      setBusy(false);
    }
  }, []);

  const closePlayer = useCallback(() => {
    videoRef.current?.pause();
    setSlot(null);
    setPhase("idle");
    setPayout(null);
  }, []);

  const convert = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/credits/convert`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as {
        convertedRupiah?: number;
        tokensGranted?: number;
        error?: { message?: string };
      };
      if (!res.ok) {
        setNotice({ kind: "warn", text: body.error?.message ?? `HTTP ${res.status}` });
        return;
      }
      setNotice({
        kind: "ok",
        text: `Converted ${rp(body.convertedRupiah ?? 0)} â†’ ${num(body.tokensGranted ?? 0)} allowance tokens.`,
      });
      await load();
    } catch (e) {
      setNotice({ kind: "warn", text: e instanceof Error ? e.message : "network error" });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const exportCsv = useCallback(() => {
    if (!ledger.length) {
      setNotice({ kind: "warn", text: "Nothing to export yet â€” watch an ad first." });
      return;
    }
    const rows: string[][] = [["time", "type", "rupiah", "tokens", "balance_after"]];
    for (const r of ledger) {
      rows.push([new Date(r.createdAt).toISOString(), r.type, String(r.amountRupiah), String(r.tokensGranted ?? 0), String(r.balanceAfter)]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `dgtlz-ad-rewards-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [ledger]);

  const filteredLedger = useMemo(() => {
    if (filter === "all") return ledger;
    if (filter === "reward") return ledger.filter((r) => r.type === "AD_REWARD");
    return ledger.filter((r) => r.type === "CONVERT" || r.type === "REFUND");
  }, [ledger, filter]);

  const chartLabels = useMemo(
    () =>
      (series?.points ?? []).map((p) =>
        new Date(`${p.day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }),
      ),
    [series],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-lg border border-[#333330] bg-[#141413] p-5 text-[12.5px] text-amber-300">
          Unable to load wallet: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-lg border border-[#262624]/60 bg-[#141413] p-5 font-mono text-[12px] text-[#8a8a86]">
          Loading ad dashboardâ€¦
        </div>
      </div>
    );
  }

  const { config, balance, today, week, earnings, quota } = data;
  const canConvert = balance.rupiah >= config.minConvertRupiah;
  const adsLeft = Math.max(0, today.adsLimit - today.adsWatched);
  const rewardRoom = Math.max(0, today.earnLimitRupiah - today.earnedRupiah);
  const canWatch = config.adsEnabled && adsLeft > 0 && rewardRoom > 0;
  const convertPct = Math.min(100, (balance.rupiah / Math.max(1, config.minConvertRupiah)) * 100);
  const watchPct = slot ? Math.min(100, (watchedMs / Math.max(1, slot.requiredWatchMs)) * 100) : 0;
  const seriesValues = (series?.points ?? []).map((p) => p.earnedRupiah);
  const avgPerAd = series && series.totals.ads > 0 ? Math.round(series.totals.earnedRupiah / series.totals.ads) : 0;
  const allowanceLeftover = Math.max(0, quota.allowanceTokens);

  return (
    <div className="flex flex-col">
      {/* ---- toolbar (Collins: breadcrumb left, actions right) ---- */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#232321] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="hidden text-[#6f6f6a] sm:inline">Analytics</span>
          <span className="hidden text-[#3f3f3b] sm:inline">/</span>
          <span className="truncate font-medium text-white">Advertisement revenue</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <button
              className="btn-ghost"
              onClick={() => setRangeOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={rangeOpen}
            >
              <span>Last {range} days</span>
              {ICON.chevron}
            </button>
            {rangeOpen && (
              <div className="absolute right-0 top-9 z-40 w-[150px] rounded-xl border border-[#333330] bg-[#111110] p-1.5 shadow-2xl">
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] text-[#d4d4d0] hover:bg-[#1d1d1b] hover:text-white"
                    onClick={() => {
                      setRange(d);
                      setRangeOpen(false);
                    }}
                  >
                    Last {d} days
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={exportCsv} className="btn-ghost hidden sm:inline-flex" title="Download reward history as CSV">
            {ICON.download}
            Export
          </button>
          <button onClick={watchAd} className="btn-white" disabled={!canWatch || busy}>
            {ICON.play}
            Watch ad
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto ide-scroll">
        <div className="mx-auto max-w-[1240px] space-y-4 p-4 sm:p-6">
          {notice && (
            <div
              className={`rounded-lg border px-3.5 py-2.5 text-[12px] ${
                notice.kind === "ok"
                  ? "border-[#2c4a38] bg-[#12211a] text-[#a9e3bd]"
                  : "border-[#4a3d1f] bg-[#211c10] text-[#f0d9a8]"
              }`}
            >
              {notice.text}
            </div>
          )}

          {!config.adsEnabled && (
            <div className="rounded-lg border border-[#4a3d1f] bg-[#211c10] px-3.5 py-2.5 text-[12px] text-[#f0d9a8]">
              Ads are paused by the operator. Your balance is untouched.
            </div>
          )}

          {/* ---- usage strip (what allowance paid for) ---- */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232321] px-4 py-3">
              <div>
                <div className="text-[12.5px] font-semibold text-white">Your usage</div>
                <div className="mt-0.5 text-[11px] text-[#8a8a86]">
                  Tokens spent on your prompts Â· allowance is used before the free quota
                </div>
              </div>
              <span className="chip">{allowanceLeftover > 0 ? "allowance active" : "free quota"}</span>
            </div>
            <div className="grid grid-cols-2 divide-[#232321] sm:grid-cols-4 sm:divide-x">
              {[
                { label: "Requests today", value: `${num(quota.requestsToday)} / ${num(quota.requestsPerDay)}` },
                { label: "Tokens today", value: `${compact(quota.tokensToday)} / ${compact(quota.tokensPerDay)}` },
                { label: "Allowance left", value: `${compact(allowanceLeftover)} tok` },
                { label: "Weekly convert cap", value: `${compact(week.tokensConverted)} / ${compact(week.tokenCap)}` },
              ].map((k) => (
                <div key={k.label} className="px-4 py-3">
                  <div className="text-[10.5px] text-[#8a8a86]">{k.label}</div>
                  <div className="mt-1 font-mono text-[13px] font-semibold text-white">{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- KPI row ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-3.5">
              <div className="text-[11px] text-[#8a8a86]">Ad credit balance</div>
              <div className="mt-1.5 font-mono text-[19px] font-semibold leading-none text-[#5fbf8a]">
                {rp(balance.rupiah)}
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-[#6f6f6a]">
                {canConvert ? "ready to convert" : `${rp(config.minConvertRupiah - balance.rupiah)} to unlock`}
              </div>
            </div>
            <div className="card p-3.5">
              <div className="text-[11px] text-[#8a8a86]">Token balance</div>
              <div className="mt-1.5 font-mono text-[19px] font-semibold leading-none text-[#67dcf2]">
                {compact(balance.allowanceTokens)} tok
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-[#6f6f6a]">
                lifetime {compact(earnings.lifetimeTokensGranted)} tok
              </div>
            </div>
            <div className="card p-3.5">
              <div className="text-[11px] text-[#8a8a86]">Average per ad</div>
              <div className="mt-1.5 font-mono text-[19px] font-semibold leading-none text-white">
                {rp(avgPerAd)}
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-[#6f6f6a]">{today.adsWatched} ads today</div>
            </div>
            <div className="card p-3.5">
              <div className="text-[11px] text-[#8a8a86]">Earned this period</div>
              <div className="mt-1.5 font-mono text-[19px] font-semibold leading-none text-white">
                {rp(series?.totals.earnedRupiah ?? 0)}
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-[#6f6f6a]">
                {series?.totals.ads ?? 0} ads Â· last {range} days
              </div>
            </div>
          </div>

          {/* ---- chart + breakdown ---- */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_310px]">
            <div className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] text-[#8a8a86]">Ad rewards over time</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-[18px] font-semibold leading-none text-white">
                      {rp(series?.totals.earnedRupiah ?? 0)}
                    </span>
                    <span className="font-mono text-[10px] text-[#5f5f5a]">
                      {series?.totals.ads ?? 0} ads watched
                    </span>
                  </div>
                </div>
                <button onClick={convert} className="btn-white" disabled={!canConvert || busy}>
                  {ICON.bolt}
                  Convert
                </button>
              </div>
              <div className="mt-4">
                <AreaChart
                  values={seriesValues.length ? seriesValues : [0, 0]}
                  labels={chartLabels}
                  color="#5fbf8a"
                  height={190}
                />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9.5px] text-[#5f5f5a]">
                {(chartLabels.length ? chartLabels : ["", ""]).map((l, i) => (
                  <span key={`${l}-${i}`}>{l}</span>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-[11px] text-[#8a8a86]">Earnings breakdown</div>
              <div className="mt-2 space-y-2">
                {[
                  { label: "Gross ad rewards", value: earnings.lifetimeRupiah, color: "#5fbf8a" },
                  { label: "Converted to tokens", value: -earnings.convertedRupiah, color: "#67dcf2" },
                  { label: "Unconverted balance", value: balance.rupiah, color: "#5fbf8a", strong: true },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-[11.5px]">
                    <span className="flex items-center gap-2 text-[#a1a19b]">
                      <span className="h-1 w-1 rounded-full" style={{ background: row.color }} />
                      {row.label}
                    </span>
                    <span
                      className={`font-mono ${row.strong ? "font-semibold" : ""}`}
                      style={{ color: row.color }}
                    >
                      {row.value < 0 ? "-" : ""}
                      {rp(Math.abs(row.value))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#232321] pt-2.5">
                <span className="text-[10.5px] text-[#8a8a86]">Available to convert</span>
                <span className="font-mono text-[12px] font-semibold text-[#67dcf2]">{rp(balance.rupiah)}</span>
              </div>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#232321]">
                <div
                  className="h-full rounded-full bg-[#5fbf8a] transition-all"
                  style={{ width: `${convertPct}%` }}
                />
              </div>
              <div className="mt-1.5 font-mono text-[9.5px] text-[#5f5f5a]">
                {canConvert
                  ? `worth ${num(balance.rupiah * config.tokensPerRupiah)} tokens`
                  : `${Math.round(convertPct)}% to Rp ${num(config.minConvertRupiah)}`}
              </div>
            </div>
          </div>

          {/* ---- ad slots + daily limits ---- */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_310px]">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#232321] px-4 py-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-white">Watch a random ad</div>
                  <div className="mt-0.5 text-[11px] text-[#8a8a86]">
                    Every ad pays {rp(700)}â€“{rp(5000)} Â· {config.minWatchPercent}% of the clip must play
                  </div>
                </div>
                <span className="font-mono text-[10px] text-[#6f6f6a]">
                  {adsLeft} slot{adsLeft === 1 ? "" : "s"} left today
                </span>
              </div>
              <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:p-6">
                <div className="relative h-[132px] w-full shrink-0 overflow-hidden rounded-xl border border-[#2c2c29] bg-[#0c0c0b] sm:w-[280px]">
                  {catalog[0]?.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={catalog[0].posterUrl}
                      alt=""
                      className="h-full w-full object-cover opacity-80"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-[10px] text-[#5f5f5a]">
                      no creative
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-[9px] tracking-widest text-white/90">
                    AD REEL
                  </span>
                </div>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <div className="text-[15px] font-semibold text-white">You don&apos;t pick the ad</div>
                  <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-[#8a8a86] sm:mx-0">
                    The server draws a creative and a reward from the slot&apos;s range before playback starts. Finish the
                    clip and the rupiah lands in your balance. Leave the tab and the ad pauses.
                  </p>
                  <button className="btn-white mt-4" onClick={watchAd} disabled={!canWatch || busy}>
                    {ICON.play}
                    {adsLeft > 0 ? "Watch ad" : "Daily limit reached"}
                  </button>
                </div>
              </div>
              <div className="px-5 pb-5 sm:px-6">
                <div className="mb-2 font-mono text-[10px] text-[#6f6f6a]">THIS ROUND</div>
                <div className="flex flex-wrap gap-1.5">
                  {catalog.map((c) => (
                    <span
                      key={c.id}
                      className="rounded border border-[#2c2c29] bg-[#1b1b19] px-2 py-1 font-mono text-[10px] text-[#a1a19b]"
                      title={c.title}
                    >
                      {c.brand}
                    </span>
                  ))}
                  {catalog.length === 0 && (
                    <span className="font-mono text-[10px] text-[#5f5f5a]">no creatives seeded</span>
                  )}
                </div>
              </div>
            </div>

            <div className="card p-4">
              <div className="text-[11px] text-[#8a8a86]">Daily limits</div>
              <div className="mt-2.5 space-y-3">
                <div>
                  <div className="flex justify-between text-[11.5px] text-[#a1a19b]">
                    <span>Ads watched</span>
                    <span className="font-mono text-white">
                      {today.adsWatched} / {today.adsLimit}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#232321]">
                    <div
                      className="h-full rounded-full bg-[#67dcf2]"
                      style={{ width: `${Math.min(100, (today.adsWatched / Math.max(1, today.adsLimit)) * 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[11.5px] text-[#a1a19b]">
                    <span>Earned today</span>
                    <span className="font-mono text-white">
                      {rp(today.earnedRupiah)} / {rp(today.earnLimitRupiah)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#232321]">
                    <div
                      className="h-full rounded-full bg-[#5fbf8a]"
                      style={{ width: `${Math.min(100, (today.earnedRupiah / Math.max(1, today.earnLimitRupiah)) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="border-t border-[#232321] pt-3">
                  <div className="flex justify-between text-[11.5px] text-[#a1a19b]">
                    <span>Lifetime earned</span>
                    <span className="font-mono text-white">{rp(earnings.lifetimeRupiah)}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] text-[#a1a19b]">
                    <span>Lifetime converted</span>
                    <span className="font-mono text-[#67dcf2]">{compact(earnings.lifetimeTokensGranted)} tok</span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] text-[#a1a19b]">
                    <span>Rate</span>
                    <span className="font-mono text-white">Rp {config.tokensPerRupiah} / token</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---- recent activity ---- */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232321] px-4 py-3">
              <span className="text-[12px] font-semibold text-white">Recent activity</span>
              <div className="flex items-center gap-0.5 text-[10.5px]">
                {(["all", "reward", "convert"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded px-2 py-0.5 transition-colors ${
                      filter === f ? "bg-[#232321] text-white" : "text-[#7c7c77] hover:text-white"
                    }`}
                  >
                    {f === "all" ? "All" : f === "reward" ? "Rewards" : "Payouts"}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-1">
              {filteredLedger.slice(0, 10).map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[#202020] py-2 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: row.type === "CONVERT" ? "#4aa8ff" : "#5fbf8a" }}
                    />
                    <span className="truncate text-[11.5px] text-[#d4d4d0]">
                      {LEDGER_LABEL[row.type] ?? row.type}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-[#5f5f5a]">{fmtWhen(row.createdAt)}</span>
                  </span>
                  <span
                    className={`text-right font-mono text-[11px] ${
                      row.amountRupiah < 0 ? "text-[#a1a19b]" : "text-[#5fbf8a]"
                    }`}
                  >
                    {row.amountRupiah > 0 ? "+" : "-"}
                    {rp(Math.abs(row.amountRupiah))}
                  </span>
                  <span className="w-[68px] text-right font-mono text-[10px] text-[#67dcf2]">
                    {row.tokensGranted ? `+${compact(row.tokensGranted)}` : "â€”"}
                  </span>
                </div>
              ))}
              {filteredLedger.length === 0 && (
                <div className="py-3 font-mono text-[11px] text-[#6f6f6a]">
                  {filter === "convert"
                    ? `No payouts yet. Conversion unlocks at ${rp(config.minConvertRupiah)}.`
                    : "No activity yet â€” press Watch ad to start earning."}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[10px] text-[#5f5f5a]">
            <span>
              Rewards land in your ad balance the moment an ad finishes Â· conversion unlocks at{" "}
              {rp(config.minConvertRupiah)} Â· ads pause when you leave the tab.
            </span>
            <span className="font-mono">DGT.LZ ADS Â· V1</span>
          </div>
        </div>
      </div>

      {/* ---- playback stage ---- */}
      {slot && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-[#2c2c29] bg-[#141413] shadow-2xl">
            {phase === "reward" && payout ? (
              <div className="px-6 py-10 text-center">
                <div
                  className="mx-auto flex h-11 w-11 items-center justify-center rounded-full text-[#0f0f0e]"
                  style={{ background: slot.creative.accent }}
                >
                  {ICON.check}
                </div>
                <div className="mt-4 font-mono text-[11px] text-[#8a8a86]">
                  {slot.creative.brand} â€” reward credited
                </div>
                <div className="mt-1 font-mono text-[34px] font-semibold leading-none text-[#5fbf8a]">
                  +{rp(payout.rewardRupiah)}
                </div>
                <div className="mt-2 font-mono text-[12px] text-[#8a8a86]">
                  Balance {rp(payout.balanceRupiah)}
                  {payout.balanceRupiah >= config.minConvertRupiah ? " Â· conversion unlocked" : ""}
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button className="btn-ghost" onClick={closePlayer}>
                    Back to dashboard
                  </button>
                  {adsLeft - 1 > 0 && (
                    <button
                      className="btn-white"
                      onClick={() => {
                        closePlayer();
                        void watchAd();
                      }}
                    >
                      Watch next ad ({adsLeft - 1} left)
                    </button>
                  )}
                </div>
              </div>
            ) : phase === "failed" ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#febc2e] text-[#0f0f0e] font-mono text-[16px] font-bold">
                  !
                </div>
                <div className="mt-4 text-[13px] text-white">No reward this time</div>
                <div className="mx-auto mt-1 max-w-sm text-[11.5px] text-[#8a8a86]">
                  {notice?.text ?? "The ad was not watched long enough."}
                </div>
                <div className="mt-6 flex justify-center gap-2">
                  <button className="btn-ghost" onClick={closePlayer}>
                    Close
                  </button>
                  <button
                    className="btn-white"
                    onClick={() => {
                      closePlayer();
                      void watchAd();
                    }}
                  >
                    Try another ad
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative aspect-video w-full bg-black">
                  <video
                    ref={videoRef}
                    src={slot.creative.videoUrl}
                    poster={slot.creative.posterUrl ?? undefined}
                    autoPlay
                    muted
                    playsInline
                    controls={false}
                    className="h-full w-full object-contain"
                    onEnded={() => void submit(slot)}
                    onPause={() => {
                      if (phase === "playing" && !document.hidden) {
                        interRef.current += 1;
                        setInterruptions(interRef.current);
                        setPhase("paused");
                      }
                    }}
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
                    <span className="rounded bg-black/50 px-2.5 py-1 font-mono text-[10px] tracking-widest text-white/90">
                      SPONSORED Â· {slot.creative.brand.toUpperCase()}
                    </span>
                    <span className="rounded bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white/90">
                      {Math.max(0, Math.ceil((slot.requiredWatchMs - watchedMs) / 1000))}s
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                    <div className="h-full bg-[#67dcf2] transition-[width]" style={{ width: `${watchPct}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[13px] font-semibold text-white">{slot.creative.title}</div>
                    <div className="text-[11.5px] text-[#8a8a86]">{slot.creative.tagline}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {phase === "paused" ? (
                      <button
                        className="btn-white"
                        onClick={() => {
                          void videoRef.current?.play();
                          setPhase("playing");
                        }}
                      >
                        Resume
                      </button>
                    ) : (
                      <button className="btn-ghost" onClick={closePlayer}>
                        Skip (no reward)
                      </button>
                    )}
                  </div>
                </div>
                {interruptions > 0 && phase === "paused" && (
                  <div className="border-t border-[#2c2c29] px-5 py-2 font-mono text-[10.5px] text-[#f0d9a8]">
                    Playback paused â€” the ad only counts while it is actually playing.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
