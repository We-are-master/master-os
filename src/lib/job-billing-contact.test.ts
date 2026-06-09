import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveJobBillingContact } from "@/lib/job-billing-contact";
import type { SupabaseClient } from "@supabase/supabase-js";

const clientId = "11111111-1111-1111-1111-111111111111";
const clientIdB = "44444444-4444-4444-4444-444444444444";
const accountId = "22222222-2222-2222-2222-222222222222";
const quoteId = "33333333-3333-3333-3333-333333333333";
const jobId = "55555555-5555-5555-5555-555555555555";
const invoiceId = "66666666-6666-6666-6666-666666666666";

type ClientRow = {
  id: string;
  full_name: string;
  email?: string | null;
  source_account_id?: string | null;
};

function mockSupabase(opts: {
  clients?: Record<string, ClientRow | null>;
  account?: {
    id: string;
    company_name: string;
    contact_name: string;
    email: string;
    finance_email?: string | null;
    billing_type?: string | null;
  } | null;
  quote?: { client_id?: string | null; client_email?: string | null } | null;
  jobQuoteId?: string | null;
  jobByInvoiceQuoteId?: string | null;
}): SupabaseClient {
  const clients = opts.clients ?? {};
  return {
    from(table: string) {
      const quoteRow = () => ({ data: opts.quote ?? null, error: null });
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (table === "quotes" && col === "id" && val === quoteId) {
            return {
              is: () => ({ maybeSingle: async () => quoteRow() }),
              maybeSingle: async () => quoteRow(),
            };
          }
          if (table === "clients" && col === "id") {
            return {
              is: () => ({
                maybeSingle: async () => ({ data: clients[val] ?? null, error: null }),
              }),
            };
          }
          if (table === "accounts" && col === "id") {
            return {
              is: () => ({
                maybeSingle: async () => ({ data: opts.account ?? null, error: null }),
              }),
            };
          }
          if (table === "jobs" && col === "id" && val === jobId) {
            return {
              is: () => ({
                maybeSingle: async () => ({
                  data: opts.jobQuoteId ? { quote_id: opts.jobQuoteId } : null,
                  error: null,
                }),
              }),
            };
          }
          if (table === "jobs" && col === "invoice_id" && val === invoiceId) {
            return {
              is: () => ({
                maybeSingle: async () => ({
                  data: opts.jobByInvoiceQuoteId ? { quote_id: opts.jobByInvoiceQuoteId } : null,
                  error: null,
                }),
              }),
            };
          }
          return chain;
        },
        is: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("resolveJobBillingContact", () => {
  it("uses quote client_id when job.client_id is missing", async () => {
    const supabase = mockSupabase({
      clients: {
        [clientId]: {
          id: clientId,
          full_name: "Patrick",
          email: "victor@getfixfy.com",
          source_account_id: accountId,
        },
      },
      account: {
        id: accountId,
        company_name: "Checkatrade",
        contact_name: "",
        email: "ops@checkatrade.com",
        billing_type: "end_client",
      },
      quote: { client_id: clientId, client_email: null },
    });
    const r = await resolveJobBillingContact(supabase, {
      client_id: null,
      client_name: "Patrick",
      quote_id: quoteId,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
    assert.equal(r.mode, "end_client");
  });

  it("uses quote.client_email when job and client row lack email", async () => {
    const supabase = mockSupabase({
      quote: { client_id: null, client_email: "victor@getfixfy.com" },
    });
    const r = await resolveJobBillingContact(supabase, {
      client_id: null,
      client_name: "Patrick",
      quote_id: quoteId,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });

  it("uses quote.client_email fallback when job.client_id set but client row has no email", async () => {
    const supabase = mockSupabase({
      clients: {
        [clientId]: {
          id: clientId,
          full_name: "Patrick",
          email: null,
          source_account_id: accountId,
        },
      },
      account: {
        id: accountId,
        company_name: "Checkatrade",
        contact_name: "",
        email: "ops@checkatrade.com",
        billing_type: "end_client",
      },
      quote: { client_id: clientId, client_email: "victor@getfixfy.com" },
    });
    const r = await resolveJobBillingContact(supabase, {
      client_id: clientId,
      client_name: "Patrick",
      quote_id: quoteId,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });

  it("retries quote.client_id when job client has no email and ids differ", async () => {
    const supabase = mockSupabase({
      clients: {
        [clientId]: {
          id: clientId,
          full_name: "Wrong",
          email: null,
          source_account_id: null,
        },
        [clientIdB]: {
          id: clientIdB,
          full_name: "Patrick",
          email: "victor@getfixfy.com",
          source_account_id: null,
        },
      },
      quote: { client_id: clientIdB, client_email: null },
    });
    const r = await resolveJobBillingContact(supabase, {
      client_id: clientId,
      client_name: "Patrick",
      quote_id: quoteId,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });

  it("resolves quote_id from job row when missing on input", async () => {
    const supabase = mockSupabase({
      clients: {
        [clientId]: {
          id: clientId,
          full_name: "Patrick",
          email: "victor@getfixfy.com",
          source_account_id: null,
        },
      },
      quote: { client_id: clientId, client_email: null },
      jobQuoteId: quoteId,
    });
    const r = await resolveJobBillingContact(supabase, {
      id: jobId,
      client_id: clientId,
      client_name: "Patrick",
      quote_id: null,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });

  it("resolves quote_id via invoice_id when job.quote_id is null", async () => {
    const supabase = mockSupabase({
      clients: {
        [clientId]: {
          id: clientId,
          full_name: "Patrick",
          email: "victor@getfixfy.com",
          source_account_id: null,
        },
      },
      quote: { client_id: clientId, client_email: null },
      jobByInvoiceQuoteId: quoteId,
    });
    const r = await resolveJobBillingContact(supabase, {
      client_id: clientId,
      client_name: "Patrick",
      quote_id: null,
      invoice_id: invoiceId,
    });
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });
});
