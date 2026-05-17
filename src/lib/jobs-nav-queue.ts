/** Session queue of job ids from Jobs Management — powers next/prev on job detail. */
const STORAGE_KEY = "master-os:jobs-nav-queue";

type JobsNavQueuePayload = { ids: string[]; at: number };

export function setJobsNavQueue(jobIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: JobsNavQueuePayload = { ids: jobIds, at: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function getJobsNavQueue(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JobsNavQueuePayload;
    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

export function getAdjacentJobId(currentId: string, direction: "next" | "prev"): string | null {
  const ids = getJobsNavQueue();
  const idx = ids.indexOf(currentId);
  if (idx === -1) return null;
  const target = direction === "next" ? idx + 1 : idx - 1;
  if (target < 0 || target >= ids.length) return null;
  return ids[target] ?? null;
}
