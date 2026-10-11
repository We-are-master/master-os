/** Presets for dashboard filtering (jobs, quotes, invoices, activity). */

export type DateRangePreset =
  | "1d"
  | "yesterday"
  | "tomorrow"
  | "wtd"
  | "last_week"
  | "next_week"
  | "7d"
  | "30d"
  | "90d"
  | "mtd"
  | "last_month"
  | "next_month"
  | "qtd"
  | "ytd"
  | "custom"
  | "all";

export interface DashboardDateBounds {
  fromIso: string;
  toIso: string;
}

/**
 * Inclusive **calendar** days (YYYY-MM-DD) matching the user’s local timezone.
 * Use this when comparing to DB date fields stored as civil dates (`due_date`, `payment_date`, …),
 * not `bounds.*.slice(0, 10)` on UTC ISO strings (that can shift the day at month boundaries).
 */
export function dashboardBoundsToInclusiveLocalYmd(bounds: DashboardDateBounds): { fromDay: string; toDay: string } {
  return { fromDay: londonYmd(new Date(bounds.fromIso)), toDay: londonYmd(new Date(bounds.toIso)) };
}

/**
 * O Pulse inteiro conta os dias em Londres (dono, 11/10/2026), não no fuso do navegador:
 * quem abre o OS de outro país tem que ver o mesmo "hoje" e o mesmo "este mês".
 *
 * `londonWallNow` devolve um Date cujos campos locais (ano, mês, dia, hora) são o relógio
 * de parede de Londres agora; as contas de período continuam usando getDate/setDate, e
 * `wallToLondonIso` transforma o resultado de volta no instante real.
 */
const LONDON_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function londonParts(d: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of LONDON_PARTS.formatToParts(d)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

export function londonYmd(d: Date): string {
  const p = londonParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function londonWallNow(now = new Date()): Date {
  const p = londonParts(now);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
}

/** Os campos locais de `wall` lidos como relógio de Londres → ISO do instante real. */
export function wallToLondonIso(wall: Date): string {
  const comoUtc = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds());
  // Diferença de Londres para UTC naquele momento (0 no inverno, +1h no verão).
  let chute = comoUtc;
  for (let i = 0; i < 2; i++) {
    const p = londonParts(new Date(chute));
    const visto = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    chute -= visto - Math.floor(comoUtc / 1000) * 1000;
  }
  return new Date(chute).toISOString();
}

/**
 * Inclusive calendar range in local browser TZ, returned as ISO strings for Supabase `.gte` / `.lte`.
 * `null` means no date filter (all time).
 */
export function getBoundsForPreset(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string
): DashboardDateBounds | null {
  if (preset === "all") return null;

  const now = londonWallNow();
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (preset === "custom") {
    if (!customFrom?.trim() || !customTo?.trim()) return null;
    const s = new Date(customFrom + "T00:00:00");
    const e = new Date(customTo + "T23:59:59.999");
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    return { fromIso: wallToLondonIso(s), toIso: wallToLondonIso(e) };
  }

  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  switch (preset) {
    case "1d":
      /* Today only — same as start */
      break;
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      break;
    }
    case "tomorrow": {
      start.setDate(start.getDate() + 1);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      break;
    }
    case "wtd": {
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      break;
    }
    case "last_week": {
      // Segunda a domingo da semana anterior, mesma semana ISO do "wtd".
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff - 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "next_week": {
      // Monday of next week through the Sunday that closes it.
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff + 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "qtd": {
      const m = now.getMonth();
      const qStartMonth = Math.floor(m / 3) * 3;
      start = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
      break;
    }
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "mtd": {
      /** Full calendar month (not month-to-date through today). */
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    }
    case "last_month": {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    }
    case "next_month": {
      start = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
      break;
    }
    case "ytd":
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
    default:
      return null;
  }

  return { fromIso: wallToLondonIso(start), toIso: wallToLondonIso(end) };
}

/**
 * Local calendar month (1st 00:00 → last day 23:59:59.999), same span as the “This month (full)” preset.
 * Used for Overview revenue KPIs (booked in month) independent of the global dashboard range.
 */
export function getLocalCalendarMonthDashboardBounds(agora = new Date()): DashboardDateBounds {
  const now = londonWallNow(agora);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { fromIso: wallToLondonIso(start), toIso: wallToLondonIso(end) };
}

export const PRESET_OPTIONS: { id: DateRangePreset; label: string }[] = [
  { id: "1d", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "wtd", label: "Week to date" },
  { id: "last_week", label: "Last week" },
  { id: "next_week", label: "Next week" },
  { id: "mtd", label: "This month (full)" },
  { id: "last_month", label: "Last month" },
  { id: "next_month", label: "Next month" },
  { id: "qtd", label: "Quarter to date" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom range" },
  { id: "all", label: "All time" },
];

export function formatRangeHint(bounds: DashboardDateBounds | null): string {
  if (!bounds) return "All time";
  try {
    const a = new Date(bounds.fromIso);
    const b = new Date(bounds.toIso);
    return `${a.toLocaleDateString(undefined, { dateStyle: "medium" })} – ${b.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  } catch {
    return "";
  }
}

const COMPACT_PRESET_LABELS: Record<DateRangePreset, string> = {
  "1d": "Today",
  yesterday: "Yesterday",
  tomorrow: "Tomorrow",
  wtd: "Week to date",
  last_week: "Last week",
  next_week: "Next week",
  mtd: "Current month",
  last_month: "Last month",
  next_month: "Next month",
  qtd: "This quarter",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
  custom: "Custom range",
  all: "All time",
};

/** Short period label for tight UI (Pulse cards, subtitles). */
export function formatCompactPeriodLabel(
  preset: DateRangePreset,
  bounds: DashboardDateBounds | null,
  customFrom?: string,
  customTo?: string,
): string {
  if (preset === "custom") {
    if (!customFrom?.trim() || !customTo?.trim() || !bounds) {
      return COMPACT_PRESET_LABELS.custom;
    }
    try {
      const a = new Date(bounds.fromIso);
      const b = new Date(bounds.toIso);
      const monthYear = a.toLocaleDateString(undefined, { month: "short", year: "numeric" });
      if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
        return `${a.getDate()}–${b.getDate()} ${monthYear}`;
      }
      const aLabel = a.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      const bLabel = b.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      return `${aLabel} – ${bLabel}`;
    } catch {
      return COMPACT_PRESET_LABELS.custom;
    }
  }
  return COMPACT_PRESET_LABELS[preset];
}
