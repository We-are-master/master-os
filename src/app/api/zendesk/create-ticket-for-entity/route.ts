import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createTicket } from "@/lib/zendesk";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/zendesk/create-ticket-for-entity
 *
 * Used by the Create Job / Create Quote modals when staff want to push the
 * record into Zendesk but there's no existing ticket to link to. We open a
 * brand-new ticket with `team@getfixfy.com` as the requester and a comment
 * containing the work details, then return the ticket id so the modal can
 * fill `external_source='zendesk'` + `external_ref` on the job/quote.
 *
 * Body (JSON):
 *   {
 *     entityType: "job" | "quote",
 *     subject:    string,
 *     commentBody?: string,
 *     htmlBody?:    string,    // either commentBody or htmlBody required
 *     extraTags?: string[],    // optional tags appended to the default ones
 *   }
 *
 * Auth: any signed-in OS user.
 * Returns: { ok: true, ticketId: number } | { ok: false, error: string }
 */

const TEAM_REQUESTER_EMAIL = "team@getfixfy.com";
const TEAM_REQUESTER_NAME  = "Fixfy Team";

interface RequestBody {
  entityType?:  "job" | "quote";
  subject?:     string;
  commentBody?: string;
  htmlBody?:    string;
  extraTags?:   string[];
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const entityType  = body.entityType === "quote" ? "quote" : body.entityType === "job" ? "job" : null;
  const subject     = body.subject?.trim();
  const commentBody = body.commentBody?.trim();
  const htmlBody    = body.htmlBody?.trim();

  if (!entityType) {
    return NextResponse.json({ ok: false, error: "entityType must be 'job' or 'quote'" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ ok: false, error: "subject is required" }, { status: 400 });
  }
  if (!commentBody && !htmlBody) {
    return NextResponse.json({ ok: false, error: "commentBody or htmlBody is required" }, { status: 400 });
  }

  const tags = ["os-created", `os-${entityType}`, ...(body.extraTags ?? [])];

  const result = await createTicket({
    subject,
    commentBody:   commentBody || undefined,
    htmlBody:      htmlBody    || undefined,
    // Private internal note: this is an OS-created placeholder ticket (requester
    // team@getfixfy.com). When the quote is later sent, the requester flips to
    // the customer — so the opening "created from OS" comment must NOT be public,
    // or the customer would see internal phrasing. The proposal is their first
    // public-facing message.
    publicComment: false,
    requesterEmail: TEAM_REQUESTER_EMAIL,
    requesterName:  TEAM_REQUESTER_NAME,
    tags,
  });

  if (!result.ok || !result.id) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Zendesk ticket creation failed" },
      { status: result.status && result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json({ ok: true, ticketId: result.id });
}
