"use client";

import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Busca que vive como ícone ao lado das ações e abre ao clicar (ou "/").
 * Com texto fica aberta; vazia fecha ao sair. Esc limpa e fecha.
 */
export function SearchExpand({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
  width = "w-64",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  /** Largura aberta (classe Tailwind). */
  width?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const open = focused || value.length > 0;

  return (
    <div
      className={cn(
        "relative flex h-8 items-center overflow-hidden rounded-lg border bg-card transition-[width,border-color] duration-200 ease-out",
        open ? cn(width, "border-border") : "w-8 border-border-light hover:border-border",
        className,
      )}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        tabIndex={open ? -1 : 0}
        onClick={() => input.current?.focus()}
        className="absolute left-0 top-0 flex h-full w-8 shrink-0 items-center justify-center text-text-secondary hover:text-text-primary"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
      <input
        ref={input}
        type="search"
        value={value}
        aria-label={label}
        placeholder={open ? placeholder : ""}
        tabIndex={open ? 0 : -1}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            input.current?.blur();
          }
        }}
        className={cn(
          "h-full w-full min-w-0 bg-transparent pl-8 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden",
          value ? "pr-7" : "pr-2",
          !open && "pointer-events-none",
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
