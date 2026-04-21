"use client";

import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  ClipboardCheck,
  Droplets,
  FileCheck,
  Flame,
  Hammer,
  HardHat,
  MapPin,
  Paintbrush,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sprout,
  Zap,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GENERAL_MAINTENANCE_LABEL, TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

/** Partner marker canvas — needs extra room for the top-right trade badge. */
const PARTNER_MARKER_SIZE = 52;
/** Trade icon rendered inside the badge circle. */
const BADGE_ICON_SIZE = 13;
const ICON_BOX = 18;

const TRADE_TO_ICON: Record<string, LucideIcon> = {
  Painter: Paintbrush,
  [GENERAL_MAINTENANCE_LABEL]: ShieldCheck,
  Plumber: Droplets,
  Electrician: Zap,
  Builder: HardHat,
  Carpenter: Hammer,
  Cleaning: Sparkles,
  Gardener: Sprout,
  "Boiler Service": Flame,
  "Electrical Installation Condition Report (EICR)": FileCheck,
  "Portable Appliance Testing (PAT)": ClipboardCheck,
  "Gas Safety Certificate (GSC)": ShieldAlert,
  "Fire Risk Assessment (FRA)": FileCheck,
  "Fire Alarm Certificate": FileCheck,
  "Fire Extinguisher Service (FES)": ShieldAlert,
};

function iconForCanonicalTrade(canonical: string): LucideIcon {
  const key = normalizeTypeOfWork(canonical) || canonical;
  return TRADE_TO_ICON[key] ?? ShieldCheck;
}

export function liveMapTradeFilterOptions(): { value: string; label: string }[] {
  return [{ value: "all", label: "All trades" }, ...TYPE_OF_WORK_OPTIONS.map((t) => ({ value: t, label: t }))];
}

function staticIcon(Icon: LucideIcon) {
  return renderToStaticMarkup(
    createElement(Icon, {
      className: "text-white",
      size: ICON_BOX,
      strokeWidth: 2,
      "aria-hidden": true,
    }),
  );
}

/** Render a lucide icon at arbitrary size/color (used for the trade badge). */
function staticIconColored(Icon: LucideIcon, size: number, color: string): string {
  return renderToStaticMarkup(
    createElement(Icon, {
      size,
      strokeWidth: 2,
      color,
      "aria-hidden": true,
    }),
  );
}

/** "Hemerson S." → "HS", "Dan L." → "DL" */
function toInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLiveMapPopupHtml(point: {
  name: string;
  inactive: boolean;
  lastUpdateIso: string;
  trade?: string;
  trades?: string[] | null;
  /** Optional lifetime (or month) completed-job count for quick ops context. */
  jobsCompleted?: number;
  /** Optional count of jobs assigned to this partner in the selected window. */
  jobsInWindow?: number;
}): string {
  const tradesList = (point.trades?.length ? point.trades : point.trade ? [point.trade] : [])
    .map((t) => normalizeTypeOfWork(String(t).trim()) || String(t).trim())
    .filter(Boolean);
  const tradeChips =
    tradesList.length > 0
      ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${tradesList
          .map(
            (t) =>
              `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#EEF2FF;color:#020040;font-size:10px;font-weight:600">${escapeHtml(
                t,
              )}</span>`,
          )
          .join("")}</div>`
      : "";
  const statusChip = point.inactive
    ? `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#FFF4ED;color:#ED4B00;font-size:10px;font-weight:600">Inactive</span>`
    : `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#E8F4EE;color:#2B9966;font-size:10px;font-weight:600">Active</span>`;
  const lastSeen = escapeHtml(new Date(point.lastUpdateIso).toLocaleString());
  const stats: string[] = [];
  if (typeof point.jobsInWindow === "number") {
    stats.push(
      `<span style="color:#64748b">Jobs in window</span> <strong style="color:#020040">${point.jobsInWindow}</strong>`,
    );
  }
  if (typeof point.jobsCompleted === "number") {
    stats.push(
      `<span style="color:#64748b">Completed</span> <strong style="color:#020040">${point.jobsCompleted}</strong>`,
    );
  }
  const statsRow =
    stats.length > 0
      ? `<div style="margin-top:6px;display:flex;gap:10px;font-size:11px">${stats.join("<span style='color:#CBD5E1'>·</span>")}</div>`
      : "";
  return `<div style="font-size:12px;line-height:1.4;min-width:200px;max-width:260px">
<strong style="display:block;font-size:13px;color:#020040">${escapeHtml(point.name)}</strong>
<div style="margin-top:4px;display:flex;align-items:center;gap:6px">${statusChip}<span style="color:#94A3B8;font-size:10px">${lastSeen}</span></div>
${tradeChips}
${statsRow}
</div>`;
}

/**
 * Partner marker — navy circle showing two-letter initials with a small
 * trade-icon badge in the top-right corner.
 *
 * Badge ring color encodes liveness (green = active, gray = inactive).
 * When a trade filter is active the badge icon switches to that trade so ops
 * can see at a glance which partners cover it.
 * Selected partners (dispatch mode) get an orange outline on the main circle.
 */
export function createLiveMapMarkerElement(opts: {
  inactive: boolean;
  tradeFilter: "all" | string;
  trade?: string;
  trades?: string[] | null;
  /** Partner display name — used to derive two-letter initials. */
  name?: string;
  /** Orange outline on the main circle when selected for dispatch. */
  selected?: boolean;
}): HTMLDivElement {
  const { inactive, tradeFilter, selected = false } = opts;

  const navy = "#020040";
  const activeColor = "#0F6E56";
  const inactiveColor = "#9A9AA0";

  /** Badge ring + icon color encodes liveness. */
  const badgeColor = inactive ? inactiveColor : activeColor;
  /** Main circle outline: orange when selected, white otherwise. */
  const circleStroke = selected ? "#ED4B00" : "white";
  const circleStrokeWidth = selected ? 3 : 2.5;
  /** Soften circle when inactive so the badge color is the primary cue. */
  const circleOpacity = inactive ? 0.55 : 1;

  const initials = opts.name ? toInitials(opts.name) : "";

  const tradesNorm = (opts.trades?.length ? opts.trades : opts.trade ? [opts.trade] : [])
    .map((t) => normalizeTypeOfWork(String(t).trim()) || String(t).trim())
    .filter(Boolean);
  const primaryTrade = tradesNorm[0] ?? "";
  const extraTrades = Math.max(0, tradesNorm.length - 1);

  /** Badge icon: prefer active trade filter, then primary trade, fallback ShieldCheck. */
  const iconTrade = tradeFilter !== "all" ? tradeFilter : primaryTrade || "";
  const TradeIcon = iconForCanonicalTrade(iconTrade);
  const badgeIconHtml = staticIconColored(TradeIcon, BADGE_ICON_SIZE, badgeColor);

  const el = document.createElement("div");
  el.className = "live-map-marker";
  el.style.cssText = [
    `width:${PARTNER_MARKER_SIZE}px`,
    `height:${PARTNER_MARKER_SIZE}px`,
    "position:relative",
    "cursor:pointer",
    "transition:transform 120ms ease",
  ].join(";");

  /** Main circle SVG with initials text. */
  const circleSvg = `<svg width="${PARTNER_MARKER_SIZE}" height="${PARTNER_MARKER_SIZE}" viewBox="0 0 ${PARTNER_MARKER_SIZE} ${PARTNER_MARKER_SIZE}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible" fill="none">` +
    `<circle cx="26" cy="26" r="20" fill="${navy}" stroke="${circleStroke}" stroke-width="${circleStrokeWidth}" opacity="${circleOpacity}"/>` +
    (initials
      ? `<text x="26" y="31" text-anchor="middle" fill="white" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" font-weight="600">${escapeHtml(initials)}</text>`
      : "") +
    `</svg>`;

  /** Trade badge — white circle top-right with colored trade icon inside.
   *  Positioned so its center lands at (41, 11) within the 52×52 canvas. */
  const badgeDiv =
    `<div style="position:absolute;top:1px;right:1px;width:20px;height:20px;` +
    `background:white;border-radius:50%;` +
    `border:2px solid ${badgeColor};` +
    `display:flex;align-items:center;justify-content:center;` +
    `box-shadow:0 1px 4px rgba(0,0,0,0.14)">` +
    badgeIconHtml +
    `</div>`;

  /** Multi-trade "+N" pill — bottom-left so it doesn't collide with the badge. */
  const multiBadge =
    extraTrades > 0 && tradeFilter === "all"
      ? `<span style="position:absolute;bottom:0;left:0;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#ED4B00;color:#fff;font-size:9px;font-weight:700;line-height:14px;text-align:center;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2)">+${extraTrades}</span>`
      : "";

  el.innerHTML = circleSvg + badgeDiv + multiBadge;

  return el;
}

/* ───────────────────────── Jobs-of-the-day overlay ────────────────────────
 * Rendered alongside partner markers in the Live Map, only for the Schedule
 * & Dispatch view's date layer. Visually distinct (square-ish, orange) so
 * ops can tell jobs apart from partner pins at a glance without any change
 * to the existing partner icon system.
 */

const JOB_MARKER_SIZE = 30;

/**
 * Status bucket that drives the job-pin color. Keeps the palette tied to the
 * existing Fixfy semantic system used across badges / KPIs so ops recognises
 * the colors instantly:
 *   unassigned  → red    (#ED073F)  — needs manual dispatch
 *   scheduled   → green  (#2B9966)  — assigned & planned
 *   in_progress → blue   (#2563EB)  — partner actively working
 *   attention   → orange (#ED4B00)  — late / need_attention / awaiting_payment / final_check
 */
export type LiveMapJobStatusCategory =
  | "unassigned"
  | "scheduled"
  | "in_progress"
  | "attention";

const JOB_STATUS_STYLE: Record<
  LiveMapJobStatusCategory,
  { color: string; icon: LucideIcon }
> = {
  unassigned: { color: "#ED073F", icon: MapPin },
  scheduled: { color: "#2B9966", icon: Briefcase },
  in_progress: { color: "#2563EB", icon: Hammer },
  attention: { color: "#ED4B00", icon: ClipboardCheck },
};

export function liveMapJobStatusLegend(): Array<{
  key: LiveMapJobStatusCategory;
  color: string;
  label: string;
}> {
  return [
    { key: "unassigned", color: JOB_STATUS_STYLE.unassigned.color, label: "Unassigned" },
    { key: "scheduled", color: JOB_STATUS_STYLE.scheduled.color, label: "Scheduled" },
    { key: "in_progress", color: JOB_STATUS_STYLE.in_progress.color, label: "In progress" },
    { key: "attention", color: JOB_STATUS_STYLE.attention.color, label: "Needs attention" },
  ];
}

/**
 * Square-ish job pin, colored by status category. Shows the job's trade icon
 * so ops can identify the type of work at a glance; falls back to a
 * status-semantic icon when no trade is available.
 * Selected pins get a thicker navy ring + gentle scale for dispatch mode.
 */
export function createLiveMapJobMarkerElement(opts: {
  selected: boolean;
  statusCategory: LiveMapJobStatusCategory;
  /** Trade label (e.g. "Carpenter", "Cleaning") — drives the icon inside the pin. */
  trade?: string;
}): HTMLDivElement {
  const { selected, statusCategory, trade } = opts;
  const style = JOB_STATUS_STYLE[statusCategory];
  const color = style.color;
  const bg = selected
    ? `linear-gradient(145deg, ${color} 0%, ${color} 100%)`
    : `linear-gradient(145deg, ${color}E6 0%, ${color} 100%)`;
  const ring = selected ? "#020040" : "rgba(255,255,255,0.95)";
  const ringWidth = selected ? 3 : 2;

  /** Prefer trade icon; fall back to status icon when trade is unknown. */
  const Icon = trade ? iconForCanonicalTrade(trade) : style.icon;
  const iconHtml = staticIcon(Icon);

  const el = document.createElement("div");
  el.className = "live-map-job-marker";
  el.style.cssText = [
    `width:${JOB_MARKER_SIZE}px`,
    `height:${JOB_MARKER_SIZE}px`,
    "border-radius:7px",
    `box-shadow:0 2px 8px rgba(0,0,0,0.22),0 0 0 ${ringWidth}px ${ring}${selected ? ",0 0 0 5px rgba(2,0,64,0.18)" : ""}`,
    `background:${bg}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:pointer",
    "transition:transform 120ms ease, box-shadow 120ms ease",
    selected ? "transform:scale(1.08)" : "",
  ].filter(Boolean).join(";");

  el.innerHTML = `<span style="display:flex;width:70%;height:70%;align-items:center;justify-content:center">${iconHtml}</span>`;

  return el;
}

export function buildLiveMapJobPopupHtml(job: {
  reference: string;
  title: string;
  partnerName: string | null;
  clientName?: string;
  propertyAddress: string;
  statusLabel: string;
  statusCategory: LiveMapJobStatusCategory;
  tradeLabel: string;
  scheduleLine: string;
  selected: boolean;
}): string {
  const statusStyle = JOB_STATUS_STYLE[job.statusCategory];
  const statusChip = `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${statusStyle.color}1A;color:${statusStyle.color};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">${escapeHtml(
    job.statusLabel,
  )}</span>`;
  const partnerLine = job.partnerName
    ? `<div style="margin-top:4px;display:flex;align-items:center;gap:4px;font-size:11px"><span style="color:#64748b">Partner</span><strong style="color:#2B9966">${escapeHtml(
        job.partnerName,
      )}</strong></div>`
    : `<div style="margin-top:4px;font-size:11px;color:#ED073F;font-weight:700">⚠ Unassigned</div>`;
  const clientLine = job.clientName
    ? `<div style="margin-top:3px;font-size:11px"><span style="color:#64748b">Client</span> <strong style="color:#020040">${escapeHtml(
        job.clientName,
      )}</strong></div>`
    : "";
  const scheduleLine = job.scheduleLine
    ? `<div style="margin-top:6px;padding:4px 6px;background:#F5F5F7;border-radius:4px;color:#020040;font-size:11px;font-weight:500">🗓 ${escapeHtml(
        job.scheduleLine,
      )}</div>`
    : "";
  const selectedChip = job.selected
    ? `<div style="margin-top:6px;display:inline-block;padding:2px 6px;border-radius:4px;background:#020040;color:#fff;font-size:10px;font-weight:600">Selected for dispatch</div>`
    : "";
  return `<div style="font-size:12px;line-height:1.4;min-width:220px;max-width:280px">
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
<span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;color:#64748b;font-weight:600">${escapeHtml(job.reference)}</span>
${statusChip}
</div>
<strong style="display:block;margin-top:4px;color:#020040;font-size:13px">${escapeHtml(job.title)}</strong>
<div style="margin-top:2px;color:#020040;font-size:11px;font-weight:500">${escapeHtml(job.tradeLabel)}</div>
${partnerLine}
${clientLine}
<div style="margin-top:4px;color:#64748b;font-size:11px">📍 ${escapeHtml(job.propertyAddress)}</div>
${scheduleLine}
${selectedChip}
</div>`;
}
