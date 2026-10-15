/**
 * Quem pode receber a cobrança automática na criação do job (dono, 13/10/2026).
 *
 * Cliente direto recebe. Cliente de plataforma não: a conta dela está com o e-mail
 * de fatura desligado (`email_include_invoice_on_final = false`), que é a mesma
 * chave que já impede o e-mail de conclusão. Uma chave só para "esta conta nunca
 * recebe fatura nossa".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChargeOnCreateDecision = { ok: true } | { ok: false; reason: string };

export function decideChargeOnCreate(account: { company_name?: string | null; email_include_invoice_on_final?: boolean | null } | null): ChargeOnCreateDecision {
  if (!account) return { ok: true };
  if (account.email_include_invoice_on_final === false) {
    return { ok: false, reason: `${account.company_name?.trim() || "This account"} does not receive invoices from us: no payment request was sent.` };
  }
  return { ok: true };
}

/**
 * O que quem chama `POST /api/jobs` pediu em `charge_on_create` (15/10/2026).
 *
 * A tela escolhe total / sinal com % / na conclusão; a API precisa aceitar o
 * mesmo vindo de script, do Harvey e do dropdown do Zendesk, que manda tag:
 *   - número 1..100 (ou "50", "50%"): porcentagem; 100 = total
 *   - "full" / "charge_full" / "total": 100
 *   - "deposit_50" / "charge_50" / "charge_deposit_30": a porcentagem
 *   - "deposit" sozinho: 50, o mesmo padrão da tela
 *   - 0, false, "on_completion" / "charge_on_completion" / "none": pedido
 *     explícito de não cobrar agora (`none`)
 *   - ausente, null ou "" (dropdown do Zendesk vazio): `absent`, quem decide é
 *     a conta (`decideApiChargeOnCreate`)
 * Qualquer outra coisa é `invalid`: o job nasce do mesmo jeito, sem cobrança.
 */
export type ChargeOnCreateRequest =
  | { kind: "absent" }
  | { kind: "none" }
  | { kind: "charge"; percent: number }
  | { kind: "invalid"; raw: string };

const SEM_COBRANCA = new Set(["none", "no", "false", "0", "on_completion", "completion", "at_completion"]);

export function parseChargeOnCreate(value: unknown): ChargeOnCreateRequest {
  if (value === undefined || value === null) return { kind: "absent" };
  if (value === false) return { kind: "none" };
  if (typeof value === "number") {
    if (value === 0) return { kind: "none" };
    const n = Math.round(value);
    return Number.isFinite(n) && n >= 1 && n <= 100 ? { kind: "charge", percent: n } : { kind: "invalid", raw: String(value) };
  }
  if (typeof value !== "string") return { kind: "invalid", raw: String(value) };
  const raw = value.trim();
  if (!raw) return { kind: "absent" };
  const v = raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/^charge_/, "");
  if (SEM_COBRANCA.has(v)) return { kind: "none" };
  if (v === "full" || v === "total" || v === "in_full") return { kind: "charge", percent: 100 };
  if (v === "deposit") return { kind: "charge", percent: 50 };
  const m = v.match(/^(?:deposit_)?(\d{1,3})(?:%|_?pct|_?percent)?$/);
  if (m) {
    const n = Number(m[1]);
    if (n === 0) return { kind: "none" };
    if (n >= 1 && n <= 100) return { kind: "charge", percent: n };
  }
  return { kind: "invalid", raw };
}

/** O pedaço da conta que decide a cobrança na criação (mig 318 + chave da fatura). */
export type ChargeAccount = {
  company_name?: string | null;
  collection_mode?: string | null;
  email_include_invoice_on_final?: boolean | null;
};

export type ApiChargeDecision =
  | { charge: true; percent: number; source: "requested" | "account_default" }
  | { charge: false; reason: string | null; requested: boolean };

/**
 * A mesma regra do modal de criação (`clientPaysUpfront` em jobs/page.tsx),
 * seguindo a configuração da conta e não só a Fixfy (dono, 15/10/2026):
 *  - plataforma (`email_include_invoice_on_final = false`) nunca é cobrada, nem
 *    se pedirem;
 *  - quem já pagou no ato (`payment_status` paid/partial) não recebe cobrança;
 *  - pedido explícito vale, inclusive "on_completion";
 *  - sem pedido: cliente sem conta ou conta "Card upfront" (`collection_mode =
 *    card_upfront`) leva o sinal de 50% na hora; conta "invoice" não leva nada
 *    (a fatura sai depois do job).
 * `reason` null = nada a dizer a quem chamou (não pediu e a conta não cobra).
 */
export function decideApiChargeOnCreate(input: {
  request: ChargeOnCreateRequest;
  account: ChargeAccount | null;
  paidAtBooking: "paid" | "partial" | null;
}): ApiChargeDecision {
  const { request, account, paidAtBooking } = input;
  const requested = request.kind !== "absent";
  if (request.kind === "invalid") {
    return { charge: false, requested, reason: `charge_on_create "${request.raw}" is not valid (use 1-100, "full", "deposit_50" or "on_completion"): no payment request was sent.` };
  }
  if (request.kind === "none") return { charge: false, requested, reason: null };
  const platform = decideChargeOnCreate(account);
  if (!platform.ok) return { charge: false, requested, reason: requested ? platform.reason : null };
  if (paidAtBooking) {
    return { charge: false, requested, reason: requested ? `The job was ${paidAtBooking === "paid" ? "paid" : "part paid"} at booking: no payment request was sent.` : null };
  }
  if (request.kind === "charge") return { charge: true, percent: request.percent, source: "requested" };
  const paysUpfront = !account || account.collection_mode === "card_upfront";
  return paysUpfront ? { charge: true, percent: 50, source: "account_default" } : { charge: false, requested, reason: null };
}

/** Conta do cliente (pelo `source_account_id`), ou null quando o cliente não tem conta. */
export async function loadChargeAccount(admin: SupabaseClient, clientId: string | null): Promise<ChargeAccount | null> {
  if (!clientId) return null;
  const { data: client } = await admin.from("clients").select("source_account_id").eq("id", clientId).maybeSingle();
  const accountId = (client as { source_account_id?: string | null } | null)?.source_account_id ?? null;
  if (!accountId) return null;
  const { data: account } = await admin
    .from("accounts")
    .select("company_name, collection_mode, email_include_invoice_on_final")
    .eq("id", accountId)
    .maybeSingle();
  return (account as ChargeAccount | null) ?? null;
}

export async function accountAllowsChargeOnCreate(admin: SupabaseClient, clientId: string | null): Promise<ChargeOnCreateDecision> {
  if (!clientId) return { ok: false, reason: "This job has no client: no payment request was sent." };
  const { data: client } = await admin.from("clients").select("source_account_id").eq("id", clientId).maybeSingle();
  const accountId = (client as { source_account_id?: string | null } | null)?.source_account_id ?? null;
  if (!accountId) return { ok: true };
  const { data: account } = await admin.from("accounts").select("company_name, email_include_invoice_on_final").eq("id", accountId).maybeSingle();
  return decideChargeOnCreate(account as { company_name?: string | null; email_include_invoice_on_final?: boolean | null } | null);
}
