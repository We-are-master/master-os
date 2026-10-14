import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { umTicketJob } from "@/lib/um-ticket/flags";
import { acharTicketDoPedido } from "@/lib/um-ticket/achar";
import {
  createTicket,
  updateTicket,
  ZENDESK_REPLY_STATUS_FIELD_ID,
  ZENDESK_REPLY_STATUS_SENT_VALUE,
} from "@/lib/zendesk";

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
 * Returns: { ok: true, ticketId: number, reused?: true } | { ok: false, error: string }
 *
 * Um ticket por pedido (ONE_TICKET_JOB_REUSE_ON, 14/10/2026): com clientId /
 * clientEmail / clientPhone no corpo e UM ticket aberto desse cliente (lead,
 * cotação, conversa do WhatsApp), devolve esse ticket com `reused: true` e o
 * texto vira nota interna nele, em vez de abrir "Job Scheduled: … - …".
 */

const TEAM_REQUESTER_EMAIL = "team@getfixfy.com";
const TEAM_REQUESTER_NAME  = "Fixfy Team";

interface RequestBody {
  entityType?:    "job" | "quote";
  subject?:       string;
  commentBody?:   string;
  htmlBody?:      string;
  extraTags?:     string[];
  /** Open the ticket already matching the OS stage (Bidding / Auto-Assigning / …). */
  customStatusId?: number;
  /** Job / Quote ticket form id. */
  ticketFormId?:  number;
  /** Prefill the form from the OS entity (field id + value). */
  customFields?:  Array<{ id: number; value: unknown }>;
  /** Quem é o cliente, para achar o ticket do pedido que já existe. */
  clientId?:      string | null;
  clientEmail?:   string | null;
  clientPhone?:   string | null;
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

  if (umTicketJob() && (body.clientId || body.clientEmail || body.clientPhone)) {
    const achado = await acharTicketDoPedido(createServiceClient(), {
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      email: typeof body.clientEmail === "string" ? body.clientEmail : null,
      telefone: typeof body.clientPhone === "string" ? body.clientPhone : null,
      exigirUnico: true,
      semVinculo: true,
    });
    if (achado.tipo === "ticket") {
      try {
        await updateTicket({
          ticketId: achado.id,
          commentBody: `${subject}\n\n${commentBody || htmlBody?.replace(/<[^>]+>/g, " ") || ""}`.trim(),
          publicComment: false,
          // Tag própria: "os-created" e "os-job" movem gatilhos de ticket aberto pelo OS, e este é do cliente.
          additionalTags: [`os-${entityType}-linked`],
        });
        return NextResponse.json({ ok: true, ticketId: achado.id, reused: true });
      } catch (err) {
        console.error("[create-ticket-for-entity] reuse failed, opening a new ticket:", err);
      }
    }
  }

  const customFields = Array.isArray(body.customFields) ? [...body.customFields] : [];
  if (ZENDESK_REPLY_STATUS_FIELD_ID > 0) {
    const hasReplyStatus = customFields.some((f) => f?.id === ZENDESK_REPLY_STATUS_FIELD_ID);
    if (!hasReplyStatus) {
      customFields.push({ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: ZENDESK_REPLY_STATUS_SENT_VALUE });
    }
  }

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
    customStatusId: typeof body.customStatusId === "number" ? body.customStatusId : undefined,
    ticketFormId:   typeof body.ticketFormId === "number" ? body.ticketFormId : undefined,
    customFields:   customFields.length > 0 ? customFields : undefined,
  });

  if (!result.ok || !result.id) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Zendesk ticket creation failed" },
      { status: result.status && result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json({ ok: true, ticketId: result.id });
}
