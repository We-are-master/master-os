import { getErrorMessage } from "@/lib/utils";

/** True when a second write with a slimmer payload might succeed (unknown column, check constraint). */
export function isPostgrestWriteRetryableError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = String((err as { code: unknown }).code);
    if (c === "PGRST204") return true;
    if (c === "23514") return true;
  }
  const msg = getErrorMessage(err, "");
  if (msg.includes("schema cache")) return true;
  if (/Could not find the .+ column/i.test(msg)) return true;
  if (msg.includes("violates check constraint")) return true;
  return false;
}
