"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, GraduationCap, LayoutGrid } from "lucide-react";
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
        href="/school"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold shrink-0 transition-colors",
          onSchoolHome
            ? "border-[#FBD9C4] bg-[#FFF5EE] text-[#E94A02]"
            : "border-[#FBD9C4] bg-gradient-to-b from-[#FFF5EE] to-[#FFEFE4] text-[#E94A02] hover:bg-[#FFE8D9] hover:border-[#F5C4A8]",
        )}
      >
        <GraduationCap className="h-4 w-4" />
        School home
      </Link>
      <span className="hidden sm:inline text-border-light" aria-hidden>
        |
      </span>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 font-semibold text-text-secondary hover:text-text-primary transition-colors shrink-0"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to OS
      </Link>
      <div className="flex flex-wrap items-center gap-2 min-w-0 sm:ml-auto">
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
      </div>
    </div>
  );
}
