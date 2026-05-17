import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Droplets,
  Flame,
  Hammer,
  Paintbrush,
  HardHat,
  Wrench,
  Sparkles,
  Trees,
  KeyRound,
  Shield,
  Grid2X2,
  Layers,
  Wind,
  Building2,
  Home,
  Car,
  Camera,
  Leaf,
  Cog,
  ShieldAlert,
} from "lucide-react";

/** Visual wrapper shared by Partners strip and Admin previews (muted, compact). */
export const SERVICE_ICON_CELL_CLASSES =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-tertiary/40 text-text-tertiary ring-1 ring-inset ring-border dark:ring-white/10";

export const SERVICE_ICON_INNER_CLASSES = "h-3.5 w-3.5 opacity-90";

/** Ordered catalogue slugs — also used by Admin dropdown. */
export const SERVICE_DISPLAY_ICON_SLUGS = [
  "appliances",
  "arborist",
  "automotive",
  "builder",
  "carpenter",
  "cleaning",
  "electrician",
  "fire_safety",
  "flooring",
  "gardener",
  "general",
  "glazing",
  "heating",
  "locksmith",
  "painter",
  "plumber",
  "roofing",
  "security",
  "surveying",
  "tiler",
  "ventilation",
] as const;

export type ServiceDisplayIconSlug = (typeof SERVICE_DISPLAY_ICON_SLUGS)[number];

export const SERVICE_DISPLAY_ICON_LABELS: Record<ServiceDisplayIconSlug, string> = {
  appliances: "Appliances",
  arborist: "Arborist / trees",
  automotive: "Automotive",
  builder: "Building / groundwork",
  carpenter: "Carpentry / joinery",
  cleaning: "Cleaning",
  electrician: "Electrical",
  fire_safety: "Fire safety / certs",
  flooring: "Flooring / carpets",
  gardener: "Garden / landscaping",
  general: "General / handyman",
  glazing: "Glazing / windows",
  heating: "Heating / boiler / gas",
  locksmith: "Locksmith",
  painter: "Painting / decorating",
  plumber: "Plumbing",
  roofing: "Roofing / gutters",
  security: "Security / CCTV",
  surveying: "Inspection / survey",
  tiler: "Tiling",
  ventilation: "Ventilation / AC",
};

const SLUG_ICON: Record<ServiceDisplayIconSlug, LucideIcon> = {
  appliances: Cog,
  arborist: Leaf,
  automotive: Car,
  builder: HardHat,
  carpenter: Hammer,
  cleaning: Sparkles,
  electrician: Zap,
  fire_safety: ShieldAlert,
  flooring: Layers,
  gardener: Trees,
  general: Wrench,
  glazing: Building2,
  heating: Flame,
  locksmith: KeyRound,
  painter: Paintbrush,
  plumber: Droplets,
  roofing: Home,
  security: Shield,
  surveying: Camera,
  tiler: Grid2X2,
  ventilation: Wind,
};

export type PartnerTradeIconEntry = { Icon: LucideIcon };

const SUGGEST_RULES: { re: RegExp; slug: ServiceDisplayIconSlug }[] = [
  { re: /eicr|electric|rewire|\bev\b|\bev\s/i, slug: "electrician" },
  { re: /\bpat\b|portable\s+appliance/i, slug: "electrician" },
  { re: /plumb|drain|leak|\bwater\b/i, slug: "plumber" },
  { re: /boiler|heating|\bgas\b|\bgsc\b|furnace|radiator/i, slug: "heating" },
  { re: /carpent|joiner|woodwork/i, slug: "carpenter" },
  { re: /paint|decor|wallpaper/i, slug: "painter" },
  { re: /build|brick|mason|groundwork|extension/i, slug: "builder" },
  { re: /clean|domestic|commercial\s+clean/i, slug: "cleaning" },
  { re: /fire\s+risk|fire\s+alarm|emergency\s+lighting|fire\s+extinguisher|\bfra\b|\bfes\b/i, slug: "fire_safety" },
  { re: /garden|landscap|turf|lawn|hedge/i, slug: "gardener" },
  { re: /tree\s+surg|arbor/i, slug: "arborist" },
  { re: /locksmith|locks?\b/i, slug: "locksmith" },
  { re: /security|alarm|cctv|access\s+control/i, slug: "security" },
  { re: /tile|tiling|\bwet\s+room/i, slug: "tiler" },
  { re: /floor|carpet|laminate|vinyl/i, slug: "flooring" },
  { re: /ventilation|extractor|air\s+con|^ac\b/i, slug: "ventilation" },
  { re: /roof|gutter/i, slug: "roofing" },
  { re: /glaz|window\s+repair|double\s+glaz/i, slug: "glazing" },
  { re: /auto|mechanic|vehicle/i, slug: "automotive" },
  { re: /photo|surveil|drone|inspection|survey\b/i, slug: "surveying" },
  { re: /appliance|white\s+goods|fridge|oven|washing/i, slug: "appliances" },
  { re: /general|handyman|maintenance|multi|property\s+care/i, slug: "general" },
];

export function isServiceDisplayIconSlug(s: string): s is ServiceDisplayIconSlug {
  return (SERVICE_DISPLAY_ICON_SLUGS as readonly string[]).includes(s);
}

export function suggestSlugFromServiceName(name?: string | null): ServiceDisplayIconSlug {
  const raw = String(name ?? "").trim();
  if (!raw) return "general";
  const hay = raw.toLowerCase();
  for (const row of SUGGEST_RULES) {
    if (row.re.test(hay)) return row.slug;
  }
  return "general";
}

export function entryForSlug(rawKey: string | null | undefined): PartnerTradeIconEntry {
  const k = String(rawKey ?? "").trim();
  if (k && isServiceDisplayIconSlug(k)) return { Icon: SLUG_ICON[k] };
  return { Icon: SLUG_ICON.general };
}

/** Options for selects: Automatic first, then A–Z by label. */
export function serviceDisplayIconSelectOptions(): { value: string; label: string }[] {
  const rest = [...SERVICE_DISPLAY_ICON_SLUGS]
    .map((slug) => ({ value: slug, label: SERVICE_DISPLAY_ICON_LABELS[slug] }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [{ value: "", label: "Automatic (from name)" }, ...rest];
}

/**
 * Resolved icon for a partner trade label using optional catalog row.
 * Stored slug wins; null/empty storage uses suggestion from catalogue name (or trade label).
 */
export function resolveServiceDisplayIcon(opts: {
  tradeLabel: string;
  catalogService?: Pick<{ name: string; display_icon_key?: string | null }, "name" | "display_icon_key"> | null;
}): PartnerTradeIconEntry {
  const { tradeLabel, catalogService } = opts;
  const stored = catalogService?.display_icon_key?.trim();
  if (stored) return entryForSlug(stored);
  const basis = catalogService?.name?.trim() || tradeLabel.trim() || "";
  return entryForSlug(suggestSlugFromServiceName(basis));
}
