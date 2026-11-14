"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Same-origin on the public domain (the tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
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

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const tok = (n: number) => `${n.toLocaleString("id-ID")} tok`;

const LEDGER_LABEL: Record<LedgerEntry["type"], string> = {
  AD_REWARD: "Ad reward",
  TOPUP: "Top-up",
  GRANT: "Grant",
  ADJUSTMENT: "Adjustment",
  CONVERT: "Converted to tokens",
  REFUND: "Refund",
};

export default function EarnPage() {
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  // Ad player state
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
      const [creditsRes, ledgerRes] = await Promise.all([
        fetch(`${GATEWAY_URL}/api/v1/credits`, { credentials: "include" }),
        fetch(`${GATEWAY_URL}/api/v1/credits/ledger?limit=12`, { credentials: "include" }),
      ]);
      if (!creditsRes.ok) throw new Error(`HTTP ${creditsRes.status}`);
      setData(await creditsRes.json());
      if (ledgerRes.ok) {
        const l = await ledgerRes.json();
        setLedger(l.entries ?? []);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- playback ticker -----------------------------------------------------
  // Counts real elapsed playback only. A hidden tab or a paused video does not
  // accrue, which is the same thing the server checks on completion.
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

  // Pausing on tab-away: the clip is not "being watched" any more.
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
        if (!body.rewarded && body.reason) {
          setNotice({ kind: "warn", text: body.reason });
        }
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
        text: `Converted ${rp(body.convertedRupiah ?? 0)} → ${tok(body.tokensGranted ?? 0)} allowance.`,
      });
      await load();
    } catch (e) {
      setNotice({ kind: "warn", text: e instanceof Error ? e.message : "network error" });
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (error) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Earn</h1>
        <div className="mt-6 text-[13px] text-amber-300">Unable to load: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Earn</h1>
        <div className="mt-6 text-[13px] text-haze-haze">Loading wallet…</div>
      </div>
    );
  }

  const { config, balance, today, week, earnings } = data;
  const canConvert = balance.rupiah >= config.minConvertRupiah;
  const adsLeft = Math.max(0, today.adsLimit - today.adsWatched);
  const rewardRoom = Math.max(0, today.earnLimitRupiah - today.earnedRupiah);
  const canWatch = config.adsEnabled && adsLeft > 0 && rewardRoom > 0;
  const convertProgress = Math.min(100, (balance.rupiah / Math.max(1, config.minConvertRupiah)) * 100);
  const watchProgress = slot ? Math.min(100, (watchedMs / Math.max(1, slot.requiredWatchMs)) * 100) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Earn</h1>
          <p className="mt-1 text-[13px] text-haze-haze">
            Watch a short ad → earn rupiah → convert it into tokens that pay for API usage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip">Rp {config.tokensPerRupiah} = 1 token</span>
          <span className="chip">min {rp(config.minConvertRupiah)}</span>
        </div>
      </div>

      {notice && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-[12.5px] ${
            notice.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          {notice.text}
        </div>
      )}

      {!config.adsEnabled && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-200">
          Ads are paused by the operator right now. Your balance is untouched.
        </div>
      )}

      {/* Wallet + convert */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label">Ad credit balance</div>
              <div className="mt-2 font-mono text-[34px] font-semibold leading-none text-emerald-300">
                {rp(balance.rupiah)}
              </div>
              <div className="mt-1 text-[12px] text-haze-haze">
                {canConvert
                  ? `Ready to convert — worth ${tok(balance.rupiah * config.tokensPerRupiah)}`
                  : `${rp(config.minConvertRupiah - balance.rupiah)} more to unlock conversion`}
              </div>
            </div>
            <div className="text-right">
              <div className="stat-label">Allowance tokens</div>
              <div className="mt-2 font-mono text-[22px] font-semibold text-glint">
                {balance.allowanceTokens.toLocaleString("id-ID")}
              </div>
              <div className="mt-1 text-[11px] text-haze-haze">spent before the free quota</div>
            </div>
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#262624]">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${convertProgress}%` }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn-white" onClick={convert} disabled={!canConvert || busy}>
              {busy ? "Working…" : `Convert ${rp(balance.rupiah)} → tokens`}
            </button>
            <button className="btn-ghost" onClick={watchAd} disabled={!canWatch || busy}>
              {adsLeft > 0 ? `Watch an ad (+Rp 700–5.000)` : "Daily ad limit reached"}
            </button>
            {!canWatch && config.adsEnabled && adsLeft === 0 && (
              <span className="text-[11.5px] text-haze-haze">resets at midnight</span>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="stat-label">Today</div>
          <div className="mt-3 space-y-3 text-[12.5px]">
            <div>
              <div className="flex justify-between text-haze-haze">
                <span>Ads watched</span>
                <span className="font-mono text-haze-white">
                  {today.adsWatched} / {today.adsLimit}
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#262624]">
                <div
                  className="h-full rounded-full bg-glint"
                  style={{ width: `${Math.min(100, (today.adsWatched / Math.max(1, today.adsLimit)) * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-haze-haze">
                <span>Earned today</span>
                <span className="font-mono text-haze-white">
                  {rp(today.earnedRupiah)} / {rp(today.earnLimitRupiah)}
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#262624]">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{ width: `${Math.min(100, (today.earnedRupiah / Math.max(1, today.earnLimitRupiah)) * 100)}%` }}
                />
              </div>
            </div>
            <div className="border-t border-[#262624] pt-3">
              <div className="flex justify-between text-haze-haze">
                <span>Lifetime earned</span>
                <span className="font-mono text-haze-white">{rp(earnings.lifetimeRupiah)}</span>
              </div>
              <div className="mt-1 flex justify-between text-haze-haze">
                <span>Lifetime converted</span>
                <span className="font-mono text-haze-white">{tok(earnings.lifetimeTokensGranted)}</span>
              </div>
              <div className="mt-1 flex justify-between text-haze-haze">
                <span>Weekly convert cap</span>
                <span className="font-mono text-haze-white">
                  {week.tokensConverted.toLocaleString("id-ID")} / {week.tokenCap.toLocaleString("id-ID")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div className="mt-6">
        <h2 className="font-display text-[15px] font-semibold text-haze-white">Recent activity</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#262624]/60">
          <table className="w-full text-[12.5px]">
            <thead className="tbl-head">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Rupiah</th>
                <th className="px-4 py-2.5 text-right">Tokens</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} className="tbl-row">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-haze-haze">
                    {new Date(row.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-haze-white">{LEDGER_LABEL[row.type] ?? row.type}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                      row.amountRupiah < 0 ? "text-haze-haze" : "text-emerald-300"
                    }`}
                  >
                    {row.amountRupiah > 0 ? "+" : ""}
                    {rp(row.amountRupiah)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-glint">
                    {row.tokensGranted ? `+${row.tokensGranted.toLocaleString("id-ID")}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-haze-haze">
                    {rp(row.balanceAfter)}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-haze-haze">
                    Nothing yet — watch an ad to start earning.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Player */}
      {slot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#2c2c29] bg-[#141413] shadow-2xl">
            {phase === "reward" && payout ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400 text-[#0f0f0e]">
                  ✓
                </div>
                <div className="mt-4 font-mono text-[11px] text-haze-haze">
                  {slot.creative.brand} — reward credited
                </div>
                <div className="mt-1 font-mono text-[34px] font-semibold leading-none text-emerald-300">
                  +{rp(payout.rewardRupiah)}
                </div>
                <div className="mt-2 text-[12.5px] text-haze-haze">
                  Balance {rp(payout.balanceRupiah)}
                  {payout.balanceRupiah >= config.minConvertRupiah ? " — conversion unlocked" : ""}
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button className="btn-ghost" onClick={closePlayer}>
                    Back to wallet
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
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-400 text-[#0f0f0e]">
                  !
                </div>
                <div className="mt-4 text-[13px] text-haze-white">No reward this time</div>
                <div className="mt-1 text-[12px] text-haze-haze">
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
                      SPONSORED · {slot.creative.brand.toUpperCase()}
                    </span>
                    <span className="rounded bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white/90">
                      {Math.max(0, Math.ceil((slot.requiredWatchMs - watchedMs) / 1000))}s
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                    <div className="h-full bg-glint transition-[width]" style={{ width: `${watchProgress}%` }} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[13px] font-semibold text-haze-white">{slot.creative.title}</div>
                    <div className="text-[12px] text-haze-haze">{slot.creative.tagline}</div>
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
                  <div className="border-t border-[#2c2c29] px-5 py-2 text-[11.5px] text-amber-200">
                    Playback paused — the ad only counts while it is actually playing.
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
