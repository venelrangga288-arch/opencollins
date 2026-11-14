"use client";

import { useEffect, useState } from "react";

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

/**
 * Client-side session guard. Verifies the session cookie against
 * /api/v1/auth/me and renders children only when signed in.
 */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/v1/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        setUser(j.user);
        setReady(true);
      })
      .catch(() => {
        window.location.href = "/dashboard/login";
      });
  }, []);

  return { user, ready };
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { ready } = useSession();
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-obsidian-950">
        <span className="spin" />
      </div>
    );
  }
  return <>{children}</>;
}
