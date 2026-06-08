"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_LINKS = [
  { href: "/", label: "Pulse", icon: LayoutGrid },
  { href: "/jobs", label: "Jobs" },
  { href: "/quotes", label: "Quotes" },
] as const;

export function SchoolEscapeBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const onSchoolHome = pathname === "/school";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-light bg-card/80 px-3 py-2 text-sm",
        className,
      )}
    >
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 font-semibold text-[#E94A02] hover:text-[#C73A00] transition-colors shrink-0"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to OS
      </Link>
      <span className="hidden sm:inline text-border-light" aria-hidden>
        |
      </span>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {QUICK_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {"icon" in item && item.icon ? <item.icon className="h-3.5 w-3.5" /> : null}
            {item.label}
          </Link>
        ))}
        {!onSchoolHome && (
          <>
            <span className="text-border-light hidden sm:inline" aria-hidden>
              ·
            </span>
            <Link
              href="/school"
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              School home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
