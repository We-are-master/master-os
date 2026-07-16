import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { SEEN_STORE_PATH, STATE_DIR } from "../config.js";
import { tzNow } from "../time.js";

type SeenEntry = {
  processedAt: string;
  kind: "lead" | "job";
  masterOsId: string;
};

type SeenMap = Record<string, SeenEntry>;

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
}

function readAll(): SeenMap {
  ensureStateDir();
  if (!existsSync(SEEN_STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SEEN_STORE_PATH, "utf8")) as SeenMap;
  } catch {
    // Corrupt/partial file (e.g. process killed mid-write) — start fresh rather
    // than crash the loop. Worst case: a handful of opportunities get re-checked.
    return {};
  }
}

/** Atomic write: temp file + rename, so a crash mid-write never corrupts seen.json. */
function writeAll(data: SeenMap): void {
  ensureStateDir();
  const tmpPath = `${SEEN_STORE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, SEEN_STORE_PATH);
}

export async function hasSeen(externalId: string): Promise<boolean> {
  const all = readAll();
  return externalId in all;
}

export async function markSeen(externalId: string, meta: { kind: "lead" | "job"; masterOsId: string }): Promise<void> {
  const all = readAll();
  all[externalId] = { processedAt: new Date().toISOString(), ...meta };
  writeAll(all);
}

/**
 * How many JOBS were actually accepted (created in Master OS) "today" in the
 * given timezone. Drives MAX_JOBS_PER_DAY. Only counts kind="job" entries
 * with a real masterOsId — a filtered-out/skipped job is marked seen with an
 * empty masterOsId and must NOT count against the daily cap.
 */
export async function countJobsAcceptedToday(tz: string): Promise<number> {
  const all = readAll();
  const todayYmd = tzNow(tz).ymd;
  let n = 0;
  for (const entry of Object.values(all)) {
    if (entry.kind !== "job" || !entry.masterOsId) continue;
    if (tzNow(tz, new Date(entry.processedAt)).ymd === todayYmd) n++;
  }
  return n;
}
