import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Basic UUID v4-style check (Postgres gen_random_uuid) */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/** Default until company_settings loads (dashboard shell syncs from DB). */
let appCurrencyCode = "GBP";

export function setAppCurrencyCode(code: string | null | undefined): void {
  if (code && /^[A-Z]{3}$/i.test(code.trim())) {
    appCurrencyCode = code.trim().toUpperCase();
  } else {
    appCurrencyCode = "GBP";
  }
}

export function getAppCurrencyCode(): string {
  return appCurrencyCode;
}

function localeForCurrency(code: string): string {
  switch (code) {
    case "GBP":
      return "en-GB";
    case "EUR":
      return "en-GB";
    case "BRL":
      return "pt-BR";
    case "USD":
    default:
      return "en-US";
  }
}

export function formatCurrency(value: number, currency?: string): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const code = currency ?? appCurrencyCode;
  return new Intl.NumberFormat(localeForCurrency(code), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safe);
}

export function formatCurrencyPrecise(value: number, currency?: string): string {
  const code = currency ?? appCurrencyCode;
  return new Intl.NumberFormat(localeForCurrency(code), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Normalizes quote/job date fields to YYYY-MM-DD only when the value is a real calendar day.
 * Rejects year-only (e.g. "2026"), partial strings, and invalid dates so Postgres date columns are not fed garbage.
 */
export function parseIsoDateOnly(input: string | undefined | null): string {
  if (input == null) return "";
  const s = String(input).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return s;
}

/** True if string is a parseable ISO-like datetime (timestamptz-safe for Supabase). */
export function isValidIsoDateTime(input: string | undefined | null): boolean {
  if (input == null || !String(input).trim()) return false;
  const t = Date.parse(String(input).trim());
  return Number.isFinite(t);
}

/** Supabase Postgrest errors are plain objects — surface `.message` in toasts. */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return fallback;
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
