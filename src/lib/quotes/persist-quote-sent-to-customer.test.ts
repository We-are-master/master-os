import assert from "node:assert/strict";
import { test } from "node:test";
import { persistQuoteSentToCustomer } from "./persist-quote-sent-to-customer";

function mockSupabase(
  errors: Array<{ message: string } | null>,
): { from: () => { update: () => { eq: () => Promise<{ error: { message: string } | null }> } } } {
  let call = 0;
  return {
    from() {
      return {
        update() {
          return {
            async eq() {
              const err = errors[call] ?? null;
              call += 1;
              return { error: err };
            },
          };
        },
      };
    },
  };
}

test("persistQuoteSentToCustomer retries without customer_pdf_sent_at when column missing", async () => {
  const supabase = mockSupabase([
    {
      message:
        "Could not find the 'customer_pdf_sent_at' column of 'quotes' in the schema cache",
    },
    null,
  ]);

  const result = await persistQuoteSentToCustomer(
    supabase as never,
    "00000000-0000-4000-8000-000000000001",
    "2026-06-12T12:00:00.000Z",
    "client@example.com",
  );

  assert.equal(result.error, null);
  assert.equal(result.customerPdfSentAtRecorded, false);
});

test("persistQuoteSentToCustomer records timestamp when full patch succeeds", async () => {
  const supabase = mockSupabase([null]);

  const result = await persistQuoteSentToCustomer(
    supabase as never,
    "00000000-0000-4000-8000-000000000001",
    "2026-06-12T12:00:00.000Z",
  );

  assert.equal(result.error, null);
  assert.equal(result.customerPdfSentAtRecorded, true);
});
