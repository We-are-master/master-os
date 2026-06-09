import "server-only";

/**
 * Wise Business REST client — covers the minimum to mint a GBP partner payout
 * from inside the OS:
 *
 *   1. Ensure a Wise recipient exists for the partner (cache id on partners).
 *   2. Quote the transfer (source GBP → target GBP).
 *   3. Create the transfer with the quote + recipient.
 *   4. Fund the transfer from the Wise GBP balance.
 *
 * Wise webhook → `wise_status` sync is intentionally NOT in this file — that
 * lives in `/api/webhooks/wise/transfer-state` (follow-up). For MVP, the
 * Payment History tab can poll `getTransfer` on demand.
 *
 * Reference: https://api-docs.transferwise.com/api-reference
 */

export type WiseConfig = {
  apiKey: string;
  profileId: number;
  baseUrl: string;
};

export type WiseResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string };

export function readWiseConfig(): WiseConfig | { error: string } {
  const apiKey = process.env.WISE_API_KEY?.trim();
  const profileRaw = process.env.WISE_PROFILE_ID?.trim();
  const base = process.env.WISE_BASE_URL?.trim() || "https://api.transferwise.com";
  if (!apiKey) return { error: "WISE_API_KEY not configured" };
  if (!profileRaw || !Number.isFinite(Number(profileRaw))) {
    return { error: "WISE_PROFILE_ID not configured (numeric profile id required)" };
  }
  return { apiKey, profileId: Number(profileRaw), baseUrl: base.replace(/\/+$/, "") };
}

async function wiseFetch<T>(
  cfg: WiseConfig,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<WiseResult<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["X-idempotence-uuid"] = init.idempotencyKey;

  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 600) || `Wise ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Wise network error" };
  }
}

/* ─── Recipients ───────────────────────────────────────────────────────────── */

export type WisePartnerBankDetails = {
  accountHolderName: string;
  sortCode: string;
  accountNumber: string;
  /** ISO country, defaults to GB. */
  legalType?: "PRIVATE" | "BUSINESS";
};

export type WiseRecipient = {
  id: number;
  accountHolderName: string;
  currency: string;
};

export async function createGbpRecipient(
  cfg: WiseConfig,
  partner: WisePartnerBankDetails,
): Promise<WiseResult<WiseRecipient>> {
  const sortCode = partner.sortCode.replace(/[^\d]/g, "");
  const accountNumber = partner.accountNumber.replace(/[^\d]/g, "");
  if (sortCode.length !== 6) {
    return { ok: false, error: "Sort code must be 6 digits" };
  }
  if (accountNumber.length !== 8) {
    return { ok: false, error: "Account number must be 8 digits" };
  }

  return wiseFetch<WiseRecipient>(cfg, "/v1/accounts", {
    method: "POST",
    body: {
      currency: "GBP",
      type: "sort_code",
      profile: cfg.profileId,
      accountHolderName: partner.accountHolderName,
      legalType: partner.legalType ?? "BUSINESS",
      details: { sortCode, accountNumber },
    },
  });
}

/* ─── Quotes ───────────────────────────────────────────────────────────────── */

export type WiseQuote = {
  id: string;
  rate: number;
  /** Amount in pence (Wise returns numeric, we keep as-is). */
  sourceAmount: number;
  targetAmount: number;
};

export async function createGbpQuote(
  cfg: WiseConfig,
  targetAmount: number,
): Promise<WiseResult<WiseQuote>> {
  return wiseFetch<WiseQuote>(cfg, `/v3/profiles/${cfg.profileId}/quotes`, {
    method: "POST",
    body: {
      sourceCurrency: "GBP",
      targetCurrency: "GBP",
      targetAmount,
      payOut: "BALANCE",
    },
  });
}

/* ─── Transfers ────────────────────────────────────────────────────────────── */

export type WiseTransfer = {
  id: number;
  status: string;
  reference: string;
  rate?: number;
  /** Wise echoes the user-supplied reference inside details. */
  details?: { reference?: string };
};

export async function createTransfer(
  cfg: WiseConfig,
  args: {
    targetAccount: number;
    quoteUuid: string;
    reference: string;
    customerTransactionId: string;
  },
): Promise<WiseResult<WiseTransfer>> {
  return wiseFetch<WiseTransfer>(cfg, "/v1/transfers", {
    method: "POST",
    idempotencyKey: args.customerTransactionId,
    body: {
      targetAccount: args.targetAccount,
      quoteUuid: args.quoteUuid,
      customerTransactionId: args.customerTransactionId,
      details: { reference: args.reference.slice(0, 18) }, // Wise GBP cap = 18 chars
    },
  });
}

export async function fundTransfer(
  cfg: WiseConfig,
  transferId: number,
): Promise<WiseResult<{ type: string; status: string }>> {
  return wiseFetch(cfg, `/v3/profiles/${cfg.profileId}/transfers/${transferId}/payments`, {
    method: "POST",
    body: { type: "BALANCE" },
  });
}

export async function getTransfer(
  cfg: WiseConfig,
  transferId: number,
): Promise<WiseResult<WiseTransfer>> {
  return wiseFetch<WiseTransfer>(cfg, `/v1/transfers/${transferId}`);
}
