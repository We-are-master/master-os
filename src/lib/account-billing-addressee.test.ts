import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNominalBillingParty, getQuoteProposalRecipientEmail } from "./account-billing-addressee";

const FIXFY_ACCOUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type ClientRow = {
  id: string;
  full_name: string;
  email?: string | null;
  source_account_id?: string | null;
};

type AccountRow = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  finance_email?: string | null;
  billing_type?: string | null;
};

function mockSupabase(client: ClientRow | null, account: AccountRow | null): SupabaseClient {
  const chain = (table: string) => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          maybeSingle: async () => {
            if (table === "clients") {
              return { data: client, error: null };
            }
            if (table === "accounts") {
              return { data: account, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  });
  return { from: chain } as unknown as SupabaseClient;
}

describe("resolveNominalBillingParty", () => {
  const originalFixfyEnv = process.env.FIXFY_ACCOUNT_ID;
  beforeEach(() => {
    process.env.FIXFY_ACCOUNT_ID = FIXFY_ACCOUNT_ID;
  });
  afterEach(() => {
    if (originalFixfyEnv === undefined) delete process.env.FIXFY_ACCOUNT_ID;
    else process.env.FIXFY_ACCOUNT_ID = originalFixfyEnv;
  });
  const clientId = "client-1";
  const accountId = "account-1";

  it("end_client mode uses clients.email", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: "patrick@example.com", source_account_id: accountId },
      {
        id: accountId,
        company_name: "Checkatrade",
        contact_name: "",
        email: "ops@checkatrade.com",
        finance_email: "billing@checkatrade.com",
        billing_type: "end_client",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.mode, "end_client");
    assert.equal(r.documentEmail, "patrick@example.com");
  });

  it("end_client mode ignores finance_email", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: null, source_account_id: accountId },
      {
        id: accountId,
        company_name: "Checkatrade",
        contact_name: "",
        email: "ops@checkatrade.com",
        finance_email: "billing@checkatrade.com",
        billing_type: "end_client",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.documentEmail, null);
  });

  it("end_client mode uses fallbackEmail when clients.email is empty", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: null, source_account_id: accountId },
      {
        id: accountId,
        company_name: "Checkatrade",
        contact_name: "",
        email: "ops@checkatrade.com",
        finance_email: null,
        billing_type: "end_client",
      },
    );
    const r = await resolveNominalBillingParty(supabase, {
      clientId,
      fallbackEmail: "victor@getfixfy.com",
    });
    assert.equal(r.mode, "end_client");
    assert.equal(r.documentEmail, "victor@getfixfy.com");
  });

  it("account mode uses finance_email", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: "patrick@example.com", source_account_id: accountId },
      {
        id: accountId,
        company_name: "Housekeep",
        contact_name: "",
        email: "ops@housekeep.com",
        finance_email: "billing@housekeep.com",
        billing_type: "account",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.mode, "account");
    assert.equal(r.documentEmail, "billing@housekeep.com");
  });

  it("account mode falls back to accounts.email", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: "patrick@example.com", source_account_id: accountId },
      {
        id: accountId,
        company_name: "Housekeep",
        contact_name: "",
        email: "ops@housekeep.com",
        finance_email: null,
        billing_type: "account",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.documentEmail, "ops@housekeep.com");
  });

  it("account mode does not fall back to clients.email", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: "patrick@example.com", source_account_id: accountId },
      {
        id: accountId,
        company_name: "Housekeep",
        contact_name: "",
        email: "",
        finance_email: null,
        billing_type: "account",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.documentEmail, null);
  });

  it("Fixfy account always uses client email even when billing_type is account", async () => {
    const supabase = mockSupabase(
      { id: clientId, full_name: "Patrick", email: "patrick@example.com", source_account_id: FIXFY_ACCOUNT_ID },
      {
        id: FIXFY_ACCOUNT_ID,
        company_name: "Fixfy",
        contact_name: "Victor",
        email: "victor@getfixfy.com",
        finance_email: "billing@getfixfy.com",
        billing_type: "account",
      },
    );
    const r = await resolveNominalBillingParty(supabase, { clientId });
    assert.equal(r.mode, "end_client");
    assert.equal(r.documentEmail, "patrick@example.com");
  });
});

describe("getQuoteProposalRecipientEmail", () => {
  const accountId = "account-1";
  const originalFixfyEnv = process.env.FIXFY_ACCOUNT_ID;
  beforeEach(() => {
    process.env.FIXFY_ACCOUNT_ID = FIXFY_ACCOUNT_ID;
  });
  afterEach(() => {
    if (originalFixfyEnv === undefined) delete process.env.FIXFY_ACCOUNT_ID;
    else process.env.FIXFY_ACCOUNT_ID = originalFixfyEnv;
  });

  it("account-only Fixfy quote does not use Fixfy ops inbox", async () => {
    const supabase = mockSupabase(null, {
      id: FIXFY_ACCOUNT_ID,
      company_name: "Fixfy",
      contact_name: "Victor",
      email: "victor@getfixfy.com",
      finance_email: null,
      billing_type: "account",
    });
    const email = await getQuoteProposalRecipientEmail(supabase, { accountId: FIXFY_ACCOUNT_ID });
    assert.equal(email, "");
  });

  it("account-only B2B account uses finance inbox", async () => {
    const supabase = mockSupabase(null, {
      id: accountId,
      company_name: "Housekeep",
      contact_name: "",
      email: "ops@housekeep.com",
      finance_email: "billing@housekeep.com",
      billing_type: "account",
    });
    const email = await getQuoteProposalRecipientEmail(supabase, { accountId });
    assert.equal(email, "billing@housekeep.com");
  });
});
