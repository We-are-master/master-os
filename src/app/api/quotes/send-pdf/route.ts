import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import React from "react";
import { QuotePDF, type QuotePDFData, type CompanyBranding } from "@/lib/pdf/quote-template";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createQuoteResponseToken } from "@/lib/quote-response-token";
import { buildQuoteEmailHTML } from "@/lib/quote-email-template";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { buildNewQuoteEmail } from "@/lib/portal-email-templates";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { getZendeskTicketId, isZendeskConfigured, sendCustomerCommentWithAttachments as zdSendCustomerComment, getTicketRequester, setTicketRequester } from "@/lib/zendesk";
import { syncAccountToZendesk } from "@/lib/zendesk-account-sync";
import { ZD_STATUS_AWAITING_APPROVAL } from "@/lib/zendesk-statuses";
import { buildQuoteSentHtml } from "@/lib/zendesk-quote-sent";

function nowMs() {
  return performance.now();
}

function withServerTiming(body: unknown, status: number, marks: Array<[string, number]>) {
  const metric = marks
    .filter(([, v]) => Number.isFinite(v) && v >= 0)
    .map(([k, v]) => `${k};dur=${Math.round(v)}`)
    .join(", ");
  const res = NextResponse.json(body, { status });
  if (metric) res.headers.set("Server-Timing", metric);
  return res;
}

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetch public site-photo URLs and build Resend attachment payloads (max 8 MB each).
 *  Photos are fetched in parallel — sequential awaits added 100s of ms per attachment. */
type SitePhotoAttachment = { filename: string; content: Buffer; contentType: string };
async function sitePhotoAttachments(photoUrls: string[]): Promise<SitePhotoAttachment[]> {
  const results = await Promise.all(
    photoUrls.map(async (rawUrl, i): Promise<SitePhotoAttachment | null> => {
      const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!raw || !isHttpsUrl(raw)) return null;
      try {
        const r = await fetch(raw);
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 8 * 1024 * 1024) return null;
        const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
        return {
          filename: `site-photo-${i + 1}.${ext}`,
          content: buf,
          contentType: ct || "image/jpeg",
        };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is SitePhotoAttachment => r !== null);
}

/**
 * Resolve a company logo URL into a data URI for the PDF.
 *
 * Why: `@react-pdf/renderer` fetches a remote `<Image src>` synchronously
 * during render with NO timeout and NO cross-request cache — on a serverless
 * runtime every send re-downloads the logo, and a slow/large asset blocks the
 * whole render for many seconds (the dominant cost behind slow quote sends).
 *
 * This pre-fetches the logo once with a hard timeout, caches the result in
 * module scope (survives warm invocations), and hands react-pdf an inline
 * data URI it never has to fetch. On timeout/failure we return `undefined`
 * so the PDF renders logo-less — identical to the existing no-logo fallback.
 */
const LOGO_FETCH_TIMEOUT_MS = 4000;
const logoDataUriCache = new Map<string, string | undefined>();

async function resolveLogoDataUri(logoUrl: string | undefined): Promise<string | undefined> {
  if (!logoUrl || !isHttpsUrl(logoUrl)) return undefined;
  if (logoDataUriCache.has(logoUrl)) return logoDataUriCache.get(logoUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(logoUrl, { signal: controller.signal });
    if (!r.ok) {
      logoDataUriCache.set(logoUrl, undefined);
      return undefined;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    // Guard against an unexpectedly huge asset blowing up the PDF/email size.
    if (buf.length > 4 * 1024 * 1024) {
      logoDataUriCache.set(logoUrl, undefined);
      return undefined;
    }
    const ct = (r.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
    const dataUri = `data:${ct};base64,${buf.toString("base64")}`;
    logoDataUriCache.set(logoUrl, dataUri);
    return dataUri;
  } catch (err) {
    console.warn("[send-pdf] logo prefetch failed/timed out — rendering without logo:", err);
    logoDataUriCache.set(logoUrl, undefined);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function renderQuotePdfToBuffer(
  data: QuotePDFData,
  branding: CompanyBranding,
): Promise<Buffer> {
  const el = React.createElement(QuotePDF, { data, branding }) as Parameters<typeof renderToBuffer>[0];
  try {
    return await renderToBuffer(el);
  } catch (err) {
    console.warn("[send-pdf] PDF render failed, retrying without logo:", err);
    const brandingNoLogo = { ...branding, logoUrl: undefined };
    return await renderToBuffer(
      React.createElement(QuotePDF, { data, branding: brandingNoLogo }) as Parameters<
        typeof renderToBuffer
      >[0],
    );
  }
}

export async function POST(req: NextRequest) {
  const startedAt = nowMs();
  const marks: Array<[string, number]> = [];
  const tAuth = nowMs();
  const auth = await requireAuth();
  marks.push(["auth", nowMs() - tAuth]);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { quoteId, recipientEmail, recipientName, notes, items, customMessage, scope, attachRequestPhotos, accountId } = body as {
      quoteId: string;
      recipientEmail?: string;
      recipientName?: string;
      notes?: string;
      customMessage?: string;
      scope?: string;
      items?: { description: string; quantity: number; unitPrice: number; total: number }[];
      /** When set, overrides saved quote preference for this send only. */
      attachRequestPhotos?: boolean;
      /** OS account id whose Zendesk organization the ticket should be filed under. */
      accountId?: string;
    };

    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (!isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Invalid quoteId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const tQuote = nowMs();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();
    marks.push(["quote_lookup", nowMs() - tQuote]);

    if (quoteError || !quote) {
      return withServerTiming({ error: "Quote not found" }, 404, marks);
    }

    // Fetch line items (if not pre-provided), company settings AND resolve the
    // nominal billing party — all in parallel. The billing-party resolution is
    // 1–2 independent DB round-trips that previously ran serially after this
    // block; folding it in here removes that serial latency from the critical
    // path. It only depends on the quote (already fetched above).
    const qForBill = quote as { client_id?: string | null; client_name?: string; client_email?: string | null };
    const qCid = qForBill.client_id?.trim() ?? "";
    const tDeps = nowMs();
    const [lineItemResult, settingsResult, docParty] = await Promise.all([
      items?.length
        ? Promise.resolve(null)
        : supabase.from("quote_line_items").select("description, quantity, unit_price").eq("quote_id", quoteId).order("sort_order"),
      supabase.from("company_settings").select("*").limit(1).single(),
      qCid.length > 0
        ? resolveNominalBillingParty(supabase, {
            clientId: qCid,
            fallbackName: qForBill.client_name,
            fallbackEmail: qForBill.client_email,
          })
        : Promise.resolve(null),
    ]);
    marks.push(["deps_fetch", nowMs() - tDeps]);

    let lineItemsForPdf = items;
    if (!lineItemsForPdf?.length && lineItemResult) {
      const rows = (lineItemResult as { data: { description: string; quantity: number; unit_price: number }[] | null }).data ?? [];
      lineItemsForPdf = rows.map((r) => ({
        description: r.description,
        quantity: Number(r.quantity) || 1,
        unitPrice: Number(r.unit_price) || 0,
        total: (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
      }));
    }

    const { data: settings } = settingsResult as { data: Record<string, unknown> | null };

    const branding: CompanyBranding = settings
      ? {
          companyName: String(settings.company_name ?? ""),
          logoUrl: settings.logo_url ? String(settings.logo_url) : undefined,
          address: String(settings.address ?? ""),
          phone: String(settings.phone ?? ""),
          email: String(settings.email ?? ""),
          website: settings.website ? String(settings.website) : undefined,
          vatNumber: settings.vat_number ? String(settings.vat_number) : undefined,
          primaryColor: String(settings.primary_color ?? "#F97316"),
          tagline: settings.tagline ? String(settings.tagline) : undefined,
        }
      : {
          companyName: "Fixfy",
          address: "123 Business Street, London, UK",
          phone: "+44 20 1234 5678",
          email: "info@mastergroup.com",
          primaryColor: "#F97316",
          tagline: "Professional Property Services",
        };

    const vatPercent =
      settings && settings.vat_percent != null
        ? Number(settings.vat_percent)
        : 20;

    const pdfClientName = String(
      (docParty ? docParty.displayName : (recipientName ?? qForBill.client_name)) ?? "",
    );
    const recipientTrimmed =
      typeof recipientEmail === "string" && recipientEmail.trim() ? recipientEmail.trim() : "";
    const pdfClientEmail =
      recipientTrimmed ||
      String(
        (docParty ? (docParty.documentEmail ?? qForBill.client_email) : qForBill.client_email) ?? "",
      );

    const pdfDataRaw: QuotePDFData = {
      reference: quote.reference,
      title: quote.title,
      clientName: pdfClientName,
      clientEmail: pdfClientEmail,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
      items: lineItemsForPdf,
      notes: notes ?? (settings?.quote_footer_notes ? String(settings.quote_footer_notes) : undefined),
      depositRequired: Number(quote.deposit_required ?? 0) || undefined,
      scope:
        typeof scope === "string" && scope.trim()
          ? scope.trim()
          : typeof quote.scope === "string" && quote.scope.trim()
            ? quote.scope.trim()
            : undefined,
      serviceType:
        typeof quote.service_type === "string" && quote.service_type.trim()
          ? quote.service_type.trim()
          : undefined,
      propertyAddress:
        typeof quote.property_address === "string" && quote.property_address.trim()
          ? quote.property_address.trim()
          : undefined,
      vatPercent,
    };

    const safePdfData: QuotePDFData = {
      ...pdfDataRaw,
      reference: String(pdfDataRaw.reference ?? ""),
      title: pdfDataRaw.title != null ? String(pdfDataRaw.title) : "Quote",
      clientName: String(pdfDataRaw.clientName ?? "").trim() || "Customer",
      clientEmail: String(pdfDataRaw.clientEmail ?? "").trim(),
      createdAt:
        typeof pdfDataRaw.createdAt === "string" && pdfDataRaw.createdAt.trim().length > 0
          ? pdfDataRaw.createdAt
          : new Date().toISOString(),
    };

    const pdfAttachmentBase = String(quote.reference ?? "quote").replace(/\//g, "-");

    // Accept/reject URLs — declared before any delivery branch so both the
    // Zendesk and Resend paths can reference them regardless of block order.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const responseToken = createQuoteResponseToken(quoteId);
    const acceptUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=accept`;
    const rejectUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=reject`;

    // ─── Choose delivery channel (computed up-front) ────────────────────────
    // Zendesk takes priority when the quote came from a ticket — the customer
    // already receives ticket replies through Zendesk, so duplicating the same
    // PDF via Resend would land twice in their inbox. Resend is only used
    // for quotes with no Zendesk linkage. Deciding this here (before the PDF
    // render) lets the Resend-only site-photo fetch overlap the render.
    const zdTicketId = getZendeskTicketId(quote as { external_source?: string | null; external_ref?: string | null });
    const zdConfigured = isZendeskConfigured();
    const useZendesk = Boolean(zdTicketId && zdConfigured);
    const qSrc = (quote as { external_source?: string | null }).external_source ?? null;
    const qRef = (quote as { external_ref?: string | null }).external_ref ?? null;
    console.log(
      `[send-pdf] Quote ${quote.reference} channel decision —`,
      `external_source=${JSON.stringify(qSrc)}`,
      `external_ref=${JSON.stringify(qRef)}`,
      `zdTicketId=${JSON.stringify(zdTicketId)}`,
      `zendeskConfigured=${zdConfigured}`,
      `→ ${useZendesk ? "ZENDESK" : "RESEND"}`,
    );
    if (zdTicketId && !zdConfigured) {
      console.warn("[send-pdf] Quote linked to Zendesk ticket", zdTicketId, "but ZENDESK_SUBDOMAIN/EMAIL/API_TOKEN are not configured. Falling back to Resend.");
    }

    // Kick off the Resend-only site-photo fetch concurrently with the logo
    // prefetch + PDF render below. Only the Resend path attaches these, so we
    // skip the work entirely for Zendesk-delivered quotes. Awaited later in the
    // Resend branch.
    const useRequestPhotos =
      typeof attachRequestPhotos === "boolean" ? attachRequestPhotos : Boolean(quote.email_attach_request_photos);
    const sitePhotosPromise: Promise<SitePhotoAttachment[]> =
      !useZendesk && useRequestPhotos && quote.request_id
        ? (async () => {
            const { data: sr } = await supabase
              .from("service_requests")
              .select("images")
              .eq("id", quote.request_id)
              .maybeSingle();
            const urls = normalizeJsonImageArray(sr?.images);
            return sitePhotoAttachments(urls);
          })()
        : Promise.resolve([]);

    // Pre-fetch the logo (bounded + cached) so react-pdf renders from an inline
    // data URI instead of issuing its own unbounded fetch during layout.
    const tLogo = nowMs();
    const logoDataUri = await resolveLogoDataUri(branding.logoUrl);
    marks.push(["logo_fetch", nowMs() - tLogo]);
    const brandingForPdf: CompanyBranding = { ...branding, logoUrl: logoDataUri };

    const tPdf = nowMs();
    const pdfBuffer = await renderQuotePdfToBuffer(safePdfData, brandingForPdf);
    marks.push(["pdf_render", nowMs() - tPdf]);

    // Track what we did to the ticket ownership for the audit log below.
    let requesterReassigned = false;
    let ticketOrganizationId: string | null = null;

    if (useZendesk) {
      // ─── Make sure the proposal reaches the customer on THIS ticket ───────
      // OS-created quotes open a ticket with team@getfixfy.com as the requester,
      // so a public comment would land in the team inbox, not the customer's.
      // Reassign the requester to the selected customer email (only when the
      // ticket is still the internal team@ one — never hijack a macro-origin
      // ticket that already has a real customer), and file the ticket under the
      // account's Zendesk organization when we have one.
      const customerEmail = recipientTrimmed || pdfClientEmail;
      const TEAM_REQUESTER = "team@getfixfy.com";

      // Resolve the account's Zendesk org id (read, else sync to create it).
      const acctId =
        (typeof accountId === "string" && accountId.trim()) ||
        (typeof (quote as { source_account_id?: string | null }).source_account_id === "string"
          ? String((quote as { source_account_id?: string | null }).source_account_id).trim()
          : "");
      if (acctId) {
        try {
          const { data: acct } = await supabase
            .from("accounts")
            .select("zendesk_organization_id")
            .eq("id", acctId)
            .maybeSingle();
          ticketOrganizationId =
            (acct as { zendesk_organization_id?: string | null } | null)?.zendesk_organization_id ?? null;
          if (!ticketOrganizationId) {
            const sync = await syncAccountToZendesk(acctId);
            ticketOrganizationId = sync.ok ? (sync.organizationId ?? null) : null;
          }
        } catch (err) {
          console.error("[send-pdf] account→org resolution failed:", err);
        }
      }

      if (customerEmail.includes("@") && customerEmail.toLowerCase() !== TEAM_REQUESTER) {
        const cur = await getTicketRequester(zdTicketId!);
        const isInternalTicket = cur.ok && cur.requesterEmail === TEAM_REQUESTER;
        if (isInternalTicket) {
          const set = await setTicketRequester({
            ticketId:       zdTicketId!,
            email:          customerEmail,
            name:           pdfClientName || (quote as { client_name?: string | null }).client_name || null,
            entityId:       (quote as { client_id?: string | null }).client_id ?? acctId ?? quoteId,
            organizationId: ticketOrganizationId ?? undefined,
          });
          if (set.ok) {
            requesterReassigned = true;
          } else {
            console.warn("[send-pdf] setTicketRequester failed for ticket", zdTicketId, "—", set.error);
          }
        } else if (!cur.ok) {
          console.warn(
            "[send-pdf] could not read requester for ticket", zdTicketId,
            "— skipping reassignment (conservative).", cur.error,
          );
        }
      }

      // ─── Zendesk delivery (awaited — sole channel) ────────────────────────
      const tZd = nowMs();
      try {
        const html = buildQuoteSentHtml({
          customerName:    pdfClientName || (quote as { client_name?: string }).client_name || "",
          reference:       String(quote.reference ?? ""),
          title:           String(quote.title ?? "Quote"),
          propertyAddress: (quote as { property_address?: string | null }).property_address ?? null,
          scope:           safePdfData.scope ?? null,
          totalGbp:        Number(quote.total_value) || 0,
          expiresAt:       quote.expires_at ?? null,
          items:           lineItemsForPdf,
          acceptUrl,
          rejectUrl,
        });
        await zdSendCustomerComment({
          ticketId:       zdTicketId!,
          customStatusId: ZD_STATUS_AWAITING_APPROVAL,
          htmlBody:       html,
          attachments: [{
            filename:    `${pdfAttachmentBase}_quote.pdf`,
            content:     pdfBuffer,
            contentType: "application/pdf",
          }],
        });
        console.log("[send-pdf] Zendesk ticket", zdTicketId, "updated for quote", quote.reference);
      } catch (err) {
        console.error("[send-pdf] Zendesk delivery failed for ticket", zdTicketId, ":", err);
        marks.push(["zendesk_send", nowMs() - tZd]);
        marks.push(["total", nowMs() - startedAt]);
        return withServerTiming(
          { error: "Failed to deliver quote via Zendesk", detail: err instanceof Error ? err.message : String(err) },
          500,
          marks,
        );
      }
      marks.push(["zendesk_send", nowMs() - tZd]);

      // Status update + audit log + portal notification (same as Resend path)
      const sentAt = new Date().toISOString();
      const tWrite = nowMs();
      const customerEmailForPersist = recipientTrimmed || pdfClientEmail;
      await supabase
        .from("quotes")
        .update({
          status: "awaiting_customer",
          customer_pdf_sent_at: sentAt,
          // Remember the email we actually sent to, so future sends + the UI
          // reflect the real customer (not the team@ placeholder).
          ...(customerEmailForPersist.includes("@") ? { client_email: customerEmailForPersist } : {}),
        })
        .eq("id", quoteId);

      void supabase.from("audit_logs").insert({
        entity_type: "quote",
        entity_id:   quoteId,
        entity_ref:  quote.reference,
        action:      "status_changed",
        field_name:  "status",
        old_value:   quote.status,
        new_value:   "awaiting_customer",
        metadata:    {
          channel: "zendesk",
          ticket_id: zdTicketId,
          requester_reassigned: requesterReassigned,
          ...(ticketOrganizationId ? { organization_id: ticketOrganizationId } : {}),
        },
      }).then(({ error }) => { if (error) console.error("audit_logs insert (send-pdf zd)", error); });

      // Portal users live in the OS portal, not in the Zendesk thread —
      // notify them through Resend if it's configured (independent of the
      // customer-facing Zendesk delivery above).
      const portalResendKey = process.env.RESEND_API_KEY?.trim();
      const portalResend    = portalResendKey ? new Resend(portalResendKey) : null;
      const portalFromEmail = portalResend
        ? (process.env.RESEND_FROM_EMAIL ?? `${branding.companyName} <quotes@${branding.website ?? "mastergroup.com"}>`)
        : null;
      void notifyPortalUsersForQuote(supabase, portalResend, portalFromEmail, {
        quoteId,
        quoteRef:    quote.reference,
        quoteTitle:  quote.title ?? "Quote",
        clientId:    (quote as { client_id?: string | null }).client_id ?? null,
      }).catch((err) => {
        console.error("[send-pdf] portal notification failed:", err);
      });

      marks.push(["db_updates", nowMs() - tWrite]);
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming({
        pdfGenerated: true,
        emailSent:    true,
        channel:      "zendesk",
        ticketId:     zdTicketId,
        sentTo:       recipientTrimmed || pdfClientEmail || "",
      }, 200, marks);
    }

    // ─── Resend path (no Zendesk linkage) ────────────────────────────────
    const emailCoerced =
      recipientTrimmed ||
      (typeof quote.client_email === "string" ? quote.client_email.trim() : "") ||
      safePdfData.clientEmail.trim();
    const emailTo = emailCoerced.trim();

    if (!emailTo || !emailTo.includes("@")) {
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming(
        {
          pdfGenerated: true,
          emailSent:    false,
          reason:
            "No valid recipient email — for “Bill to this account” quotes, ensure the account has a billing/finance email in Accounts.",
        },
        200,
        marks,
      );
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${branding.companyName} <quotes@${branding.website ?? "mastergroup.com"}>`;

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (!resendKey) {
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming(
        { pdfGenerated: true, emailSent: false, reason: "RESEND_API_KEY not configured" },
        200,
        marks,
      );
    }
    const resend = new Resend(resendKey);

    const emailAttachments: { filename: string; content: Buffer; contentType?: string }[] = [
      {
        filename: `${pdfAttachmentBase}_quote.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];
    // Site photos were fetched concurrently with the PDF render (see above) —
    // just await the already-running promise here instead of fetching serially.
    if (useRequestPhotos && quote.request_id) {
      const tPhotos = nowMs();
      const extras = await sitePhotosPromise;
      emailAttachments.push(...extras);
      // Time spent blocked on photos AFTER render — usually ~0 since the fetch
      // ran concurrently with the render/logo above.
      marks.push(["photos_wait", nowMs() - tPhotos]);
    }

    const tEmail = nowMs();
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      subject: `Quote ${quote.reference} — ${quote.title}`,
      html: buildQuoteEmailHTML(safePdfData, branding, { acceptUrl, rejectUrl, customMessage }),
      attachments: emailAttachments,
    });
    marks.push(["email_send", nowMs() - tEmail]);

    if (emailError) {
      console.error("Resend error:", emailError);
      marks.push(["total", nowMs() - startedAt]);
      const reason =
        typeof emailError === "object" && emailError !== null && "message" in emailError
          ? String((emailError as { message: unknown }).message)
          : "Email delivery failed (Resend)";
      return withServerTiming(
        { pdfGenerated: true, emailSent: false, reason },
        200,
        marks,
      );
    }

    const sentAt = new Date().toISOString();
    const tWrite = nowMs();
    /** Quote status update is awaited (caller relies on it); audit log is fire-and-forget. */
    await supabase
      .from("quotes")
      .update({ status: "awaiting_customer", customer_pdf_sent_at: sentAt })
      .eq("id", quoteId);

    void supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: "awaiting_customer",
      metadata: { email_to: emailTo, resend_id: emailResult?.id },
    }).then(({ error }) => { if (error) console.error("audit_logs insert (send-pdf)", error); });

    // ─── Portal user notification (fire-and-forget) ─────────────────────────
    // Look up portal users for the account that owns this quote and send them
    // a separate notification email pointing at /portal/quotes/[id]. Additive
    // — the existing customer email above still goes out unchanged.
    void notifyPortalUsersForQuote(supabase, resend, fromEmail, {
      quoteId,
      quoteRef:    quote.reference,
      quoteTitle:  quote.title ?? "Quote",
      clientId:    (quote as { client_id?: string | null }).client_id ?? null,
    }).catch((err) => {
      console.error("[send-pdf] portal notification failed:", err);
    });

    marks.push(["db_updates", nowMs() - tWrite]);
    marks.push(["total", nowMs() - startedAt]);

    return withServerTiming({
      pdfGenerated: true,
      emailSent: true,
      emailId: emailResult?.id,
      sentTo: emailTo,
    }, 200, marks);
  } catch (err) {
    console.error("Quote PDF/send error:", err);
    const marks: Array<[string, number]> = [["total", nowMs() - startedAt]];
    const detail = err instanceof Error ? err.message : String(err);
    return withServerTiming(
      { error: "Failed to generate or send quote PDF", detail },
      500,
      marks,
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const quoteId = req.nextUrl.searchParams.get("quoteId");
    if (!quoteId) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (!isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Invalid quoteId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const [lineItemResult, settingsResult] = await Promise.all([
      supabase
        .from("quote_line_items")
        .select("description, quantity, unit_price")
        .eq("quote_id", quoteId)
        .order("sort_order"),
      supabase.from("company_settings").select("*").limit(1).single(),
    ]);

    const lineRows = (lineItemResult as { data: { description: string; quantity: number; unit_price: number }[] | null }).data ?? [];
    const items =
      lineRows.length > 0
        ? lineRows.map((r) => ({
            description: r.description,
            quantity: Number(r.quantity) || 1,
            unitPrice: Number(r.unit_price) || 0,
            total: (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
          }))
        : undefined;

    const { data: settings } = settingsResult as { data: Record<string, unknown> | null };

    const branding: CompanyBranding = settings
      ? {
          companyName: String(settings.company_name ?? ""),
          logoUrl: settings.logo_url ? String(settings.logo_url) : undefined,
          address: String(settings.address ?? ""),
          phone: String(settings.phone ?? ""),
          email: String(settings.email ?? ""),
          website: settings.website ? String(settings.website) : undefined,
          vatNumber: settings.vat_number ? String(settings.vat_number) : undefined,
          primaryColor: String(settings.primary_color ?? "#F97316"),
          tagline: settings.tagline ? String(settings.tagline) : undefined,
        }
      : {
          companyName: "Fixfy",
          address: "124 City Road, London, UK",
          phone: "+44 20 1234 5678",
          email: "support@getfixfy.com",
          primaryColor: "#F97316",
          tagline: "Professional Property Services",
        };

    const vatPercentPreview =
      settings && settings.vat_percent != null
        ? Number(settings.vat_percent)
        : 20;

    const pdfData: QuotePDFData = {
      reference: quote.reference,
      title: quote.title,
      clientName: quote.client_name,
      clientEmail: quote.client_email,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
      items,
      notes: settings?.quote_footer_notes ? String(settings.quote_footer_notes) : undefined,
      depositRequired: Number(quote.deposit_required ?? 0) || undefined,
      scope: typeof quote.scope === "string" && quote.scope.trim() ? quote.scope.trim() : undefined,
      serviceType:
        typeof quote.service_type === "string" && quote.service_type.trim() ? quote.service_type.trim() : undefined,
      propertyAddress:
        typeof quote.property_address === "string" && quote.property_address.trim() ? quote.property_address.trim() : undefined,
      vatPercent: vatPercentPreview,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await (renderToBuffer as any)(
      React.createElement(QuotePDF, { data: pdfData, branding }),
    );

    const safeName = `${quote.reference.replace(/\//g, "-")}_quote.pdf`;
    const asAttachment = req.nextUrl.searchParams.get("download") === "1";

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="${safeName}"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 },
    );
  }
}

/**
 * Look up portal users for the account that owns this quote (via the
 * clients.source_account_id chain) and send them a notification email
 * pointing at /portal/quotes/[id]. Fire-and-forget — failure must not
 * block the customer-facing send-pdf flow.
 */
async function notifyPortalUsersForQuote(
  supabase: ReturnType<typeof createServiceClient>,
  resend:   Resend | null,
  fromEmail: string | null,
  args: {
    quoteId:    string;
    quoteRef:   string;
    quoteTitle: string;
    clientId:   string | null;
  },
): Promise<void> {
  if (!args.clientId) return;
  if (!resend || !fromEmail) return;

  // Resolve the client → account → portal users chain
  const { data: client } = await supabase
    .from("clients")
    .select("source_account_id")
    .eq("id", args.clientId)
    .maybeSingle();
  const accountId = (client as { source_account_id?: string | null } | null)?.source_account_id;
  if (!accountId) return;

  const { data: account } = await supabase
    .from("accounts")
    .select("company_name")
    .eq("id", accountId)
    .maybeSingle();
  const accountName = (account as { company_name?: string } | null)?.company_name ?? "your account";

  const { data: portalUsers } = await supabase
    .from("account_portal_users")
    .select("id, email, is_active")
    .eq("account_id", accountId)
    .eq("is_active", true);

  const recipients = ((portalUsers ?? []) as Array<{ email: string }>)
    .map((u) => u.email)
    .filter((e): e is string => typeof e === "string" && e.includes("@"));
  if (recipients.length === 0) return;

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    "https://app.getfixfy.com";
  const portalUrl = `${appUrl}/portal/quotes/${args.quoteId}`;

  const { subject, html } = buildNewQuoteEmail({
    accountName,
    quoteRef:   args.quoteRef,
    quoteTitle: args.quoteTitle,
    portalUrl,
  });

  await resend.emails.send({
    from:    fromEmail,
    to:      recipients,
    subject,
    html,
  });
}
