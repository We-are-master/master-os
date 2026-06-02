import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { setTicketJobReference, setTicketCustomField, ZENDESK_JOB_ID_FIELD_ID } from "@/lib/zendesk";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
const MAX_REF_LEN   = 64;

/**
 * POST /api/jobs/[id]/zendesk-link
 * Body: { ticketId: string | null }
 *
 * Sets `external_source = 'zendesk'` + `external_ref = <ticketId>` when
 * ticketId is provided, or clears both when ticketId is null/empty. This
 * is the single source of truth the Zendesk integration keys off — the
 * status-sync trigger, partner side conversations, and lifecycle
 * dispatches all read external_source/external_ref to decide whether to
 * fire.
 *
 * Auth: admin/manager/operator only.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  let body: { ticketId?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawTicket = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
  const ticketRef = rawTicket.length > 0 ? rawTicket : null;
  if (ticketRef && ticketRef.length > MAX_REF_LEN) {
    return NextResponse.json(
      { error: `Ticket id is too long (max ${MAX_REF_LEN} chars).` },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Capture the previously-linked ticket so we can clear its job-id field
  // when the user unlinks (the request body carries no ticket id on unlink).
  const { data: prev } = await admin
    .from("jobs")
    .select("reference, external_source, external_ref")
    .eq("id", jobId)
    .maybeSingle();
  const prevTicket = (prev as { external_source?: string | null; external_ref?: string | null } | null);
  const prevTicketId = prevTicket?.external_source === "zendesk" ? prevTicket?.external_ref ?? null : null;
  const jobRef = (prev as { reference?: string | null } | null)?.reference ?? null;

  const update = ticketRef
    ? { external_source: "zendesk", external_ref: ticketRef }
    : { external_source: null, external_ref: null };

  const { error } = await admin
    .from("jobs")
    .update(update)
    .eq("id", jobId);

  if (error) {
    console.error("[zendesk-link] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mirror the job reference into the ticket's job-id field on link, or clear
  // it on the previously-linked ticket on unlink. Best-effort, non-blocking.
  if (ticketRef) {
    void setTicketJobReference(ticketRef, jobRef).then((r) => {
      if (!r.ok) console.error("[zendesk-link] setTicketJobReference failed:", r.error);
    });
  } else if (prevTicketId) {
    void setTicketCustomField({ ticketId: prevTicketId, fieldId: ZENDESK_JOB_ID_FIELD_ID, value: null });
  }

  void admin.from("audit_logs").insert({
    entity_type: "job",
    entity_id:   jobId,
    action:      ticketRef ? "zendesk_linked" : "zendesk_unlinked",
    field_name:  "external_ref",
    new_value:   ticketRef,
    metadata:    { external_source: ticketRef ? "zendesk" : null },
  }).then(({ error: e }) => { if (e) console.error("audit_logs (zendesk-link):", e.message); });

  return NextResponse.json({ ok: true, externalSource: ticketRef ? "zendesk" : null, externalRef: ticketRef });
}
