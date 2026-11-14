import type { Metadata } from "next";
import Link from "next/link";
import CommandTabs from "./command-tabs";

export const metadata: Metadata = {
  title: "DGT.LZ â€” the coding gateway",
  description:
    "DGT.LZ Gateway plans, edits and tests code across your repo through a single [OI]-compatible endpoint. One key, transparent usage.",
};

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1";

const ABOUT = [
  {
    n: ".01",
    title: "One Endpoint",
    body: "A single [OI]-compatible base URL for every model on the plan. Point any OpenAI SDK, agent, or pipeline at it â€” no per-provider glue.",
  },
  {
    n: ".02",
    title: "Tool Calling",
    body: "Full streaming and non-streaming tool-call aggregation. Agents can read files, run tests and iterate â€” not just chat.",
  },
  {
    n: ".03",
    title: "Metered & Auditable",
    body: "Every request is metered per key, per model, per day. Quotas, revocation and audit logs live in the operator console.",
  },
];

export default function CollinsLandingPage() {
  return (
    <main className="min-h-screen bg-[#f4fbff] text-[#041024]">
      {/* â”€â”€ Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/collins" className="font-display text-xl font-extrabold tracking-tight">
          DGT.LZ
        </Link>
        <div className="flex items-center gap-5 text-sm font-medium text-[#0d56b8]">
          <a href="#how" className="hover:underline">How to use</a>
          <a href="#about" className="hover:underline">About</a>
          <a href="#start" className="hover:underline">Get started</a>
          <Link
            href="/dashboard"
            className="rounded-full bg-[#041024] px-4 py-2 text-white transition-colors hover:bg-[#0d56b8]"
          >
            Dashboard â†’
          </Link>
        </div>
      </nav>

      {/* â”€â”€ Hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#0d56b8]/25 bg-white/60 px-4 py-1.5 font-mono text-xs text-[#0d56b8]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#0d56b8]" />
          {BASE}
        </div>
        <h1 className="mt-8 font-display text-[64px] font-extrabold leading-[0.95] tracking-tight sm:text-[110px]">
          Autonomous,
          <br />
          <span className="italic font-editorial font-normal text-[#0d56b8]">unlimited,</span> coding.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#041024]/70">
          One gateway for every model on your plan. Streaming, tool calling and usage metering â€”
          drop-in compatible with the OpenAI SDK you already use.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-full bg-[#041024] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0d56b8]"
          >
            Open dashboard
          </Link>
          <a
            href="#start"
            className="rounded-full border border-[#041024]/20 bg-white/70 px-6 py-3 text-sm font-semibold transition-colors hover:border-[#0d56b8] hover:text-[#0d56b8]"
          >
            Get your key
          </a>
        </div>
      </section>

      {/* â”€â”€ About â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section id="about" className="border-t border-[#041024]/10 bg-white/50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            The basics of{" "}
            <span className="italic font-editorial font-normal text-[#0d56b8]">gateway intelligence</span>
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {ABOUT.map((a) => (
              <div key={a.n} className="border-t border-[#041024]/15 pt-4">
                <div className="font-mono text-xs text-[#0d56b8]">{a.n}</div>
                <h3 className="mt-2 font-display text-lg font-bold">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#041024]/70">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* â”€â”€ Get started / copy-command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section id="start" className="border-t border-[#041024]/10">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Get started in{" "}
            <span className="italic font-editorial font-normal text-[#0d56b8]">one command</span>
          </h2>
          <p className="mt-3 text-sm text-[#041024]/70">
            Create a key in the dashboard, then point your stack at the base URL.
          </p>
          <CommandTabs />
        </div>
      </section>
      <section id="how" className="border-t border-[#041024]/10 bg-white/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-bold">Streaming</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#041024]/70">
              Add <code className="rounded bg-[#041024]/5 px-1.5 py-0.5 font-mono text-xs">&quot;stream&quot;: true</code>{" "}
              to receive standard Server-Sent Events with usage in the final chunk.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold">Errors</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#041024]/70">
              Every failure returns one standardized envelope with a request id â€” easy to log, easy to retry.
            </p>
          </div>
        </div>
      </section>

      {/* â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <footer className="bg-[#041024] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10">
          <div className="font-display text-lg font-extrabold">DGT.LZ</div>
          <div className="flex flex-wrap gap-6 text-sm text-white/70">
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
            <Link href="/keys" className="hover:text-white">API Keys</Link>
            <Link href="/docs" className="hover:text-white">Docs</Link>
            <Link href="/operator" className="hover:text-white">Operator</Link>
          </div>
          <div className="font-mono text-xs text-white/40">{BASE}</div>
        </div>
      </footer>
    </main>
  );
}
