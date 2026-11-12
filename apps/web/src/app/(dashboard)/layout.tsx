import Link from "next/link";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/playground", label: "API Playground" },
  { href: "/keys", label: "API Keys" },
  { href: "/usage", label: "Usage & Analytics" },
  { href: "/models", label: "Models" },
  { href: "/docs", label: "Documentation" },
  { href: "/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 dark:border-neutral-800 md:block">
        <div className="px-6 py-6">
          <div className="text-sm font-semibold tracking-tight">
            DGT.LZ <span className="text-blue-600 dark:text-blue-400">Gateway</span>
          </div>
        </div>
        <nav className="px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
