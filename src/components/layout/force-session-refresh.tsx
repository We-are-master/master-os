import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Invalidates sessions that predate `profiles.session_valid_after`.
 * Used after deploy to force linked workforce users to sign in again.
 */
export async function enforceSessionRefresh() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("session_valid_after")
    .eq("id", user.id)
    .maybeSingle();

  const sessionValidAfter = (profile as { session_valid_after?: string | null } | null)
    ?.session_valid_after;
  if (!sessionValidAfter || !user.last_sign_in_at) return;

  const validAfterMs = new Date(sessionValidAfter).getTime();
  const lastSignInMs = new Date(user.last_sign_in_at).getTime();
  if (!Number.isNaN(validAfterMs) && !Number.isNaN(lastSignInMs) && lastSignInMs < validAfterMs) {
    redirect("/auth/sign-out");
  }
}
