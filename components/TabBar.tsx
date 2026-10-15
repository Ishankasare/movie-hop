"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);

const TABS = [
  { href: "/", label: "Home", match: (p: string) => p === "/", icon: icon(<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { href: "/solo", label: "Solo", match: (p: string) => p.startsWith("/solo"), icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5 3.5-5 3.5z" /></>) },
  { href: "/race", label: "Race", match: (p: string) => p.startsWith("/race"), icon: icon(<><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></>) },
  { href: "/how-to-play", label: "How to play", match: (p: string) => p.startsWith("/how-to-play"), icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></>) },
];

/** Bottom navigation. Hidden while a round is being played so the board gets the full screen. */
export default function TabBar() {
  const pathname = usePathname();
  // hidden while playing: a solo round, or inside a race room (/race/<code>)
  if (pathname.startsWith("/play") || pathname.startsWith("/race/")) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-background/85 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                  active ? "text-accent-soft" : "text-muted hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
