"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Overview", glyph: "◧" },
  { href: "/dashboard/playground", label: "Playground", glyph: "▷" },
  { href: "/dashboard/keys", label: "API Keys", glyph: "⚿" },
  { href: "/dashboard/usage", label: "Usage", glyph: "◫" },
  { href: "/dashboard/models", label: "Models", glyph: "≡" },
  { href: "/dashboard/docs", label: "Docs", glyph: "⌗" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-obsidian-950 text-haze-bright">
      {/* ── Rail (icon nav) ─────────────────────────────── */}
      <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-obsidian-600/40 bg-obsidian-900 py-3">
        <Link
          href="/collins"
          className="rail-btn font-display text-sm font-extrabold text-haze-white"
          title="DGT.LZ landing"
        >
          D
        </Link>
        <div className="mx-2 my-1 h-px bg-obsidian-600/50" />
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`rail-btn ${
              pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href))
                ? "rail-on"
                : ""
            }`}
          >
            {item.glyph}
          </Link>
        ))}
        <div className="flex-1" />
        <Link href="/operator" className="rail-btn" title="Operator console">
          ⚙
        </Link>
      </div>

      {/* ── Sidebar ─────────────────────────────────────── */}
      <div className="hidden w-56 shrink-0 flex-col border-r border-obsidian-600/40 bg-obsidian-850 md:flex">
        <div className="px-4 py-4">
          <div className="font-display text-sm font-bold text-haze-white">
            DGT.LZ <span className="text-glint">Gateway</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-haze-haze">workstation · v1</div>
        </div>
        <div className="px-4 pb-2 font-mono text-[10px] uppercase tracking-widest text-haze-haze">
          Workspace
        </div>
        <nav className="space-y-0.5 px-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`side-btn ${
                pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href))
                  ? "bg-obsidian-700 text-white"
                  : ""
              }`}
            >
              <span className="w-4 text-center text-haze-haze">{item.glyph}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="card p-3">
            <div className="font-mono text-[10px] text-haze-haze">BASE URL</div>
            <div className="mt-1 break-all font-mono text-[10px] text-glint">
              {process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <main className="ide-scroll flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">{children}</div>
      </main>
    </div>
  );
}
