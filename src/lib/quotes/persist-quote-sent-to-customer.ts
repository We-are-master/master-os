import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePostgrestUnknownColumnName } from "@/lib/supabase-schema-compat";
import { sincronizarLeadDaQuote } from "@/lib/crm/lead-servidor";

export type PersistQuoteSentResult = {
  error: { message: string } | null;
  /** `customer_pdf_sent_at` was written (false on older DBs missing that column). */
  customerPdfSentAtRecorded: boolean;
};

export async function persistQuoteSentToCustomer(
  supabase: SupabaseClient,
  quoteId: string,
  sentAt: string,
  clientEmail?: string,
): Promise<PersistQuoteSentResult> {
  let payload: Record<string, unknown> = {
    status: "awaiting_customer",
    customer_pdf_sent_at: sentAt,
  };
  if (clientEmail?.includes("@")) {
    payload.client_email = clientEmail;
  }

  let customerPdfSentAtRecorded = true;

  for (let attempt = 0; attempt < 16; attempt++) {
    const { error } = await supabase.from("quotes").update(payload).eq("id", quoteId);
    if (!error) {
      // CRM: a quote foi ao cliente, o lead dela vai para Quote sent (nunca derruba o envio).
      await sincronizarLeadDaQuote(supabase, quoteId, { evento: "quote_sent", chaveDoEvento: sentAt });
      return { error: null, customerPdfSentAtRecorded };
    }

    const missingCol = parsePostgrestUnknownColumnName(error);
    if (missingCol && missingCol in payload && missingCol !== "status") {
      if (missingCol === "customer_pdf_sent_at") {
        customerPdfSentAtRecorded = false;
      }
      const { [missingCol]: _, ...rest } = payload;
      payload = rest;
      continue;
    }

    return { error: { message: error.message }, customerPdfSentAtRecorded: false };
  }

  return { error: { message: "Quote status update exhausted schema retries" }, customerPdfSentAtRecorded: false };
}
