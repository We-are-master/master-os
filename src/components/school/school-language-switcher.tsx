"use client";

import { cn } from "@/lib/utils";
import { SCHOOL_LOCALE_OPTIONS } from "@/lib/fixfy-school-locale";
import { useFixfySchoolLocale } from "@/hooks/use-fixfy-school-locale";

type Props = {
  className?: string;
  variant?: "hero" | "inline";
};

export function SchoolLanguageSwitcher({ className, variant = "inline" }: Props) {
  const { locale, setLocale } = useFixfySchoolLocale();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg p-0.5",
        variant === "hero"
          ? "bg-white/10 border border-white/15 backdrop-blur-sm"
          : "bg-surface-hover border border-border-light",
        className,
      )}
      role="group"
      aria-label="Training language"
    >
      {SCHOOL_LOCALE_OPTIONS.map((opt) => {
        const active = locale === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setLocale(opt.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all",
              variant === "hero"
                ? active
                  ? "bg-white text-[#020034] shadow-sm"
                  : "text-white/70 hover:text-white hover:bg-white/10"
                : active
                  ? "bg-card text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <span aria-hidden>{opt.flag}</span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
