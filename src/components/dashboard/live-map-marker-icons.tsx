"use client";

import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  Droplets,
  FileCheck,
  Flame,
  Hammer,
  HardHat,
  Layers,
  MapPin,
  Paintbrush,
  ShieldAlert,
  Sparkles,
  Sprout,
  Wrench,
  Zap,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GENERAL_MAINTENANCE_LABEL, TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

const DEFAULT_MARKER_SIZE = 36;
const ICON_BOX = 18;

const TRADE_TO_ICON: Record<string, LucideIcon> = {
  Painter: Paintbrush,
  [GENERAL_MAINTENANCE_LABEL]: Wrench,
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
  return TRADE_TO_ICON[key] ?? Wrench;
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
}): string {
  const tradesList = (point.trades?.length ? point.trades : point.trade ? [point.trade] : [])
    .map((t) => normalizeTypeOfWork(String(t).trim()) || String(t).trim())
    .filter(Boolean);
  const tradeLine =
    tradesList.length > 0
      ? `<div style="margin-top:4px;color:#64748b;font-size:11px">${escapeHtml(tradesList.join(" · "))}</div>`
      : "";
  return `<div style="font-size:12px;line-height:1.35">
<strong>${escapeHtml(point.name)}</strong><br/>
${point.inactive ? "Inactive" : "Active"}<br/>
${escapeHtml(new Date(point.lastUpdateIso).toLocaleString())}
${tradeLine}
</div>`;
}

/** Brand default (All) = blue pin; multi-trade = layers; single trade with filter = that trade icon. */
export function createLiveMapMarkerElement(opts: {
  inactive: boolean;
  tradeFilter: "all" | string;
  trade?: string;
  trades?: string[] | null;
}): HTMLDivElement {
  const { inactive, tradeFilter } = opts;
  const ring = inactive ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)";
  const brandBlue = "linear-gradient(145deg, #2563eb 0%, #1d4ed8 100%)";
  const tradeTint = inactive ? "linear-gradient(145deg, #d97706 0%, #b45309 100%)" : "linear-gradient(145deg, #16a34a 0%, #15803d 100%)";

  const tradesNorm = (opts.trades?.length ? opts.trades : opts.trade ? [opts.trade] : [])
    .map((t) => normalizeTypeOfWork(String(t).trim()) || String(t).trim())
    .filter(Boolean);
  const isMulti = tradesNorm.length > 1;

  let innerHtml: string;
  if (tradeFilter !== "all") {
    const Icon = iconForCanonicalTrade(tradeFilter);
    innerHtml = staticIcon(Icon);
  } else if (isMulti) {
    innerHtml = staticIcon(Layers);
  } else {
    innerHtml = staticIcon(MapPin);
  }

  const bg = tradeFilter === "all" ? brandBlue : tradeTint;

  const el = document.createElement("div");
  el.className = "live-map-marker";
  el.style.cssText = [
    `width:${DEFAULT_MARKER_SIZE}px`,
    `height:${DEFAULT_MARKER_SIZE}px`,
    "border-radius:9999px",
    `box-shadow:0 2px 10px rgba(0,0,0,0.18),0 0 0 3px ${ring}`,
    `background:${bg}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:pointer",
  ].join(";");

  el.innerHTML = `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center">${innerHtml}</span>`;

  return el;
}
