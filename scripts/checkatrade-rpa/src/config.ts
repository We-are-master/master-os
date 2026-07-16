import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function envStr(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}
function envNum(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}
/** "handyman, eicr, safety check" → ["handyman","eicr","safety check"] (lowercased). */
function envCsvStrings(name: string): string[] {
  const v = process.env[name]?.trim();
  if (!v) return [];
  return v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
/** "2,3,4,5" → [2,3,4,5]. */
function envCsvInts(name: string, fallback: number[]): number[] {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const out = v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return out.length > 0 ? out : fallback;
}

export type SlotSelectionStrategy = "earliest" | "latest";

export type RpaConfig = {
  /** false = visible browser window (watch it work). true = no window (unattended). */
  headless: boolean;
  /** Which opportunity kind(s) this run acts on. Restrict to ["lead"] for a controlled test run. */
  processKinds: ("lead" | "job")[];

  /** When the bot polls/acts, and how often. All time checks use `timezone`. */
  schedule: {
    pollIntervalSeconds: number; // POLL_INTERVAL
    pollJitter: number;          // POLL_JITTER — random fraction added per cycle (0.6 = up to +60%)
    runDays: number[];           // RUN_DAYS — getDay() values (Sun=0..Sat=6) the bot runs on
    runStartHour: number;        // RUN_START_HOUR (default 8) — inclusive
    runEndHour: number;          // RUN_END_HOUR (default 20) — exclusive
    timezone: string;            // RUN_TIMEZONE
  };

  acceptance: {
    /** AUTO_ACCEPT — when false, a matching job is logged/notified but NOT accepted on Checkatrade. */
    autoAccept: boolean;
    /** MAX_JOBS_PER_DAY — 0 = unlimited. Counted from seen.json entries accepted "today" in `timezone`. */
    maxJobsPerDay: number;
  };

  /** Filters that decide whether a JOB (Checkatrade Express) is worth accepting. Leads are never filtered. */
  jobFilters: {
    keywords: string[];       // JOB_KEYWORDS — job title/description must contain at least one (empty = no keyword filter)
    minValue: number;         // MIN_JOB_VALUE — £, 0 = any
    minDateDaysAhead: number; // MIN_DATE_DAYS_AHEAD — accepted slot must be >= this many days from today
    slotDays: number[];       // JOB_SLOT_DAYS — accepted slot's weekday must be one of these (Sun=0..Sat=6)
  };

  /** Optional extra filters from config.json (rarely used; keyword filter above is the main gate). */
  filters: {
    enabled: boolean;
    categories: string[];
    regions: string[];
  };

  /**
   * Checkatrade category/title → Master OS Services catalog name. Master OS
   * only accepts canonical catalog names ("Handyman", "Plumber", …); unmapped
   * ones fall back to fallbackCategory rather than failing the lead/job.
   */
  categoryMap: Record<string, string>;
  /** Used when a Checkatrade category has no categoryMap entry. Must be a real, active Services catalog name. */
  fallbackCategory: string;

  booking: {
    slotSelectionStrategy: SlotSelectionStrategy;
  };
  masterOs: {
    baseUrl: string;
    accountId: string;
  };
  env: {
    checkatradeEmail: string;
    checkatradePassword: string;
    masterOsJobApiKey: string;
    masterOsLeadApiKey: string;
  };
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

export function loadConfig(): RpaConfig {
  loadEnvFile(resolve(ROOT, ".env"));

  const raw = JSON.parse(readFileSync(resolve(ROOT, "config.json"), "utf8")) as Record<string, unknown>;
  const filters = (raw.filters ?? {}) as Record<string, unknown>;
  const booking = (raw.booking ?? {}) as Record<string, unknown>;
  const masterOs = (raw.masterOs ?? {}) as Record<string, unknown>;

  const accountId = String(masterOs.accountId ?? "").trim();
  if (!accountId || accountId === "REPLACE_WITH_YOUR_CHECKATRADE_ACCOUNT_ID") {
    throw new Error("Set masterOs.accountId in config.json to your Checkatrade jobs account_id.");
  }

  const processKindsRaw = Array.isArray(raw.processKinds) ? (raw.processKinds as string[]) : ["lead", "job"];
  const processKinds = processKindsRaw.filter((k): k is "lead" | "job" => k === "lead" || k === "job");

  // Poll interval: POLL_INTERVAL is in SECONDS (the .env format). Fall back to
  // config.json's legacy pollIntervalMinutes, then a 60s default.
  const legacyMinutes = Number(raw.pollIntervalMinutes ?? 0) || 0;
  const pollIntervalSeconds = envNum("POLL_INTERVAL", legacyMinutes > 0 ? legacyMinutes * 60 : 60);

  return {
    // RPA_HEADLESS overrides config.json — Docker sets it to "true" since the
    // container has no display; local runs keep the visible window.
    headless: envBool("RPA_HEADLESS", raw.headless !== false),
    processKinds: processKinds.length > 0 ? processKinds : ["lead", "job"],

    schedule: {
      pollIntervalSeconds: pollIntervalSeconds > 0 ? pollIntervalSeconds : 60,
      pollJitter: Math.max(0, envNum("POLL_JITTER", 0)),
      runDays: envCsvInts("RUN_DAYS", [0, 1, 2, 3, 4, 5, 6]),
      runStartHour: Math.min(23, Math.max(0, envNum("RUN_START_HOUR", 8))),
      runEndHour: Math.min(24, Math.max(1, envNum("RUN_END_HOUR", 20))),
      timezone: envStr("RUN_TIMEZONE") ?? "Europe/London",
    },

    acceptance: {
      autoAccept: envBool("AUTO_ACCEPT", true),
      maxJobsPerDay: Math.max(0, envNum("MAX_JOBS_PER_DAY", 0)),
    },

    jobFilters: {
      keywords: envCsvStrings("JOB_KEYWORDS"),
      minValue: Math.max(0, envNum("MIN_JOB_VALUE", 0)),
      minDateDaysAhead: Math.max(0, envNum("MIN_DATE_DAYS_AHEAD", 0)),
      slotDays: envCsvInts("JOB_SLOT_DAYS", [0, 1, 2, 3, 4, 5, 6]),
    },

    filters: {
      enabled: Boolean(filters.enabled),
      categories: Array.isArray(filters.categories) ? (filters.categories as string[]) : [],
      regions: Array.isArray(filters.regions) ? (filters.regions as string[]) : [],
    },

    categoryMap:
      raw.categoryMap && typeof raw.categoryMap === "object" ? (raw.categoryMap as Record<string, string>) : {},
    fallbackCategory: String(raw.fallbackCategory ?? "General Maintenance").trim() || "General Maintenance",
    booking: {
      slotSelectionStrategy: (booking.slotSelectionStrategy as SlotSelectionStrategy) === "latest" ? "latest" : "earliest",
    },
    masterOs: {
      // MASTER_OS_BASE_URL overrides config.json — Docker points it at
      // host.docker.internal:3000 (the host's localhost is unreachable inside
      // the container).
      baseUrl: String(envStr("MASTER_OS_BASE_URL") ?? masterOs.baseUrl ?? "https://app.getfixfy.com").replace(/\/$/, ""),
      accountId,
    },
    env: {
      checkatradeEmail: requireEnv("CHECKATRADE_EMAIL"),
      checkatradePassword: requireEnv("CHECKATRADE_PASSWORD"),
      masterOsJobApiKey: requireEnv("MASTER_OS_JOB_WEBHOOK_API_KEY"),
      masterOsLeadApiKey: requireEnv("MASTER_OS_LEAD_WEBHOOK_API_KEY"),
    },
  };
}

export const STATE_DIR = resolve(ROOT, ".state");
export const STORAGE_STATE_PATH = resolve(STATE_DIR, "storage-state.json");
export const SEEN_STORE_PATH = resolve(STATE_DIR, "seen.json");
