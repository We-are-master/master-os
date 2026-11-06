import type { BadgeVariant } from "@/components/ui/badge";
import type { LeadSegment, LeadStage } from "@/types/database";

/** Cor da etapa: estado, não categoria (VOS UNO §9). */
export const STAGE_VARIANT: Record<LeadStage, BadgeVariant> = {
  new: "primary",
  qualifying: "default",
  qualified: "info",
  quoting: "warning",
  quoted: "info",
  won: "success",
  lost: "danger",
};

/** Status da quote com o MESMO nome do Zendesk e da tela de Quotes, e a cor do chip no card. */
/** Status da quote no card, nas cores do OS: neutro, e cor só quando pede ação. */
const NEUTRO = "bg-surface-tertiary text-text-secondary";
export const QUOTE_STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: NEUTRO },
  in_survey: { label: "Sourcing", cls: NEUTRO },
  bidding: { label: "Sourcing", cls: NEUTRO },
  quote_ready: { label: "Ready to send", cls: "bg-success text-white" },
  awaiting_customer: { label: "Awaiting approval", cls: NEUTRO },
  awaiting_payment: { label: "Awaiting deposit", cls: "bg-warning-light text-warning" },
  rejected: { label: "Rejected", cls: "bg-danger-light text-danger" },
  converted_to_job: { label: "Converted to job", cls: "bg-success-light text-success" },
};

export const SEGMENT_LABEL: Record<LeadSegment, string> = { b2c: "B2C", b2b: "B2B" };

export const gbp = (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

/** "12 min", "3 h", "2 days". */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** "Today 15:00", "Tomorrow 10:00", "Fri 07/11 09:00". */
export function formatWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const ymd = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getTime() + 86400000));
  const yesterday = ymd(new Date(now.getTime() - 86400000));
  const day = ymd(d);
  if (day === today) return `Today ${time}`;
  if (day === tomorrow) return `Tomorrow ${time}`;
  if (day === yesterday) return `Yesterday ${time}`;
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/London" });
  return `${label.replace(",", "")} ${time}`;
}

export function isOverdue(iso: string | null | undefined, now = Date.now()): boolean {
  return !!iso && Date.parse(iso) <= now;
}

/** ISO → valor de <input type="datetime-local"> no horário local do navegador. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const textareaClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30";

export function zendeskTicketUrl(id: string | number | null | undefined): string | null {
  if (!id) return null;
  return `https://${process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN || "fixfy"}.zendesk.com/agent/tickets/${id}`;
}
