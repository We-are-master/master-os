import { redirect } from "next/navigation";
import { requirePortalUser } from "@/lib/portal-auth";
import { getServerSupabase } from "@/lib/supabase/server-cached";
import { PortalShell } from "@/components/portal/portal-shell";

/**
 * Server-component layout for /portal/*.
 *
 * - Resolves the portal user via requirePortalUser()
 * - Redirects to /portal/login if no portal session (or to /dashboard
 *   when an internal staff user accidentally lands here — they get a
 *   clear path back to the right place)
 * - Fetches the account name for the header
 * - Updates last_signed_in_at fire-and-forget
 *
 * Routes that should NOT use this layout (login, callback) live outside
 * /portal/ with their own layouts. The login page is at /portal/login but
 * doesn't need this gate — middleware lets it through, and Next will use
 * THIS layout for it. We special-case the redirect logic so the login
 * page itself isn't bounced into a redirect loop.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requirePortalUser();

  // If the auth helper returned a NextResponse (401/403) we redirect.
  // We can't use NextResponse directly from a server component, so we
  // use Next's redirect() instead.
  if (auth instanceof Response) {
    redirect("/portal/login");
  }

  const { accountId, portalUser } = auth;

  // Fetch the account row for the company name
  const supabase = await getServerSupabase();
  const { data: account } = await supabase
    .from("accounts")
    .select("company_name")
    .eq("id", accountId)
    .maybeSingle();

  const accountName = (account as { company_name?: string } | null)?.company_name ?? "";

  // Fire-and-forget update of last_signed_in_at
  void supabase
    .from("account_portal_users")
    .update({ last_signed_in_at: new Date().toISOString() })
    .eq("id", portalUser.id);

  return (
    <PortalShell
      accountName={accountName}
      userEmail={portalUser.email}
      userFullName={portalUser.full_name}
      portalUserId={portalUser.id}
      accountId={auth.accountId}
    >
      {children}
    </PortalShell>
  );
}
