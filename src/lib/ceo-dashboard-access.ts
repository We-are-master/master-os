import type { Profile } from "@/types/database";

/**
 * CEO financial dashboard is hidden unless the signed-in user matches an allowlist.
 * Set one or both (comma-separated):
 * - NEXT_PUBLIC_CEO_DASHBOARD_ALLOWED_EMAILS (lowercase match)
 * - NEXT_PUBLIC_CEO_DASHBOARD_ALLOWED_USER_IDS (Supabase auth user UUIDs)
 *
 * If both lists are empty, no one sees the CEO tab (safe default).
 */
export function isCeoDashboardAllowedUser(profile: Pick<Profile, "id" | "email"> | null | undefined): boolean {
  if (!profile?.id && !profile?.email) return false;

  const emails = (process.env.NEXT_PUBLIC_CEO_DASHBOARD_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const ids = (process.env.NEXT_PUBLIC_CEO_DASHBOARD_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (emails.length === 0 && ids.length === 0) return false;

  const mail = profile.email?.trim().toLowerCase();
  if (mail && emails.includes(mail)) return true;
  if (profile.id && ids.includes(profile.id)) return true;
  return false;
}
