"use client";

import { useCallback, useEffect, useState } from "react";

// Same-origin on the public domain (tunnel routes /api/v1/* to the gateway);
// only fall back to the local gateway when browsing from localhost.
const GATEWAY_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4101"
    : "";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
}

type SessionState =
  | { phase: "loading" }
  | { phase: "ready"; user: SessionUser }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string };

/**
 * Client-side session guard. Verifies the session cookie against
 * /api/v1/auth/me and redirects to the login page ONLY when the gateway
 * explicitly says the session is missing/expired (401/403). Network or
 * 5xx failures render a retry screen instead — that prevents redirect
 * loops when the gateway is briefly unavailable.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ phase: "loading" });

  const check = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        setState({ phase: "unauthenticated" });
        return;
      }
      if (!res.ok) {
        setState({ phase: "error", message: `Gateway responded ${res.status}` });
        return;
      }
      const json = (await res.json()) as { user?: SessionUser };
      if (!json.user) {
        setState({ phase: "unauthenticated" });
        return;
      }
      setState({ phase: "ready", user: json.user });
    } catch {
      setState({ phase: "error", message: "Cannot reach the gateway." });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (state.phase === "unauthenticated") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/dashboard/login?next=${next}`);
    }
  }, [state.phase]);

  const user = state.phase === "ready" ? state.user : null;
  return { user, state, ready: state.phase === "ready", retry: check };
}

export function SessionStatus({
  state,
  retry,
}: {
  state: SessionState;
  retry: () => void;
}) {
  if (state.phase === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-obsidian-950 px-6 text-center">
        <div className="font-display text-lg font-bold text-haze-white">Gateway unreachable</div>
        <div className="max-w-sm text-[13px] text-haze-haze">{state.message}</div>
        <div className="flex gap-2">
          <button onClick={() => void retry()} className="btn-white">
            Retry
          </button>
          <a href="/dashboard/login" className="btn-ghost">
            Sign in
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-screen items-center justify-center bg-obsidian-950">
      <span className="spin" />
    </div>
  );
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { state, retry } = useSession();
  if (state.phase === "ready") return <>{children}</>;
  return <SessionStatus state={state} retry={retry} />;
}
