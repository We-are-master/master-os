import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export interface PortalUserRow {
  id: string;
  account_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

export interface PortalAuthResult {
  user: User;
  accountId: string;
  portalUser: PortalUserRow;
}

/**
 * Auth gate for the account portal (`/portal/*` and `/api/portal/*`).
 *
 * Returns the authenticated portal user OR a NextResponse:
 *   - 401 if no Supabase session
 *   - 403 if the user is logged in but is NOT a portal user (e.g. internal
 *         staff trying to access portal routes, or an external partner)
 *   - 403 if the portal user row exists but is_active = false
 *
 * Use in API route handlers AND server components:
 *
 *     const auth = await requirePortalUser();
 *     if (auth instanceof NextResponse) return auth;
 *     const { accountId, portalUser } = auth;
 *
 * In server components, you typically want to redirect instead of returning
 * a 403 — call `requirePortalUserOrRedirect()` for that.
 */
export async function requirePortalUser(): Promise<PortalAuthResult | NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const { data: row, error: rowErr } = await supabase
    .from("account_portal_users")
    .select("id, account_id, email, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (rowErr || !row) {
    return NextResponse.json(
      { error: "Forbidden", message: "Portal access required" },
      { status: 403 }
    );
  }

  const portalUser = row as PortalUserRow;

  if (!portalUser.is_active) {
    return NextResponse.json(
      { error: "Forbidden", message: "Portal access disabled for this user" },
      { status: 403 }
    );
  }

  return {
    user,
    accountId: portalUser.account_id,
    portalUser,
  };
}

/**
 * Server-component variant — returns the portal auth result OR redirects to
 * `/portal/login` (no exception thrown). Use this from RSC pages so the
 * redirect happens before any data fetching.
 *
 * Throws a redirect via Next's `redirect()` from "next/navigation" — caller
 * should not catch it.
 */
export async function requirePortalUserOrRedirect(): Promise<PortalAuthResult> {
  const result = await requirePortalUser();
  if (result instanceof NextResponse) {
    // Lazy import so this module stays usable from API routes too.
    const { redirect } = await import("next/navigation");
    redirect("/portal/login");
    // Unreachable — redirect() throws — but TS needs the explicit return.
    throw new Error("unreachable");
  }
  return result;
}
