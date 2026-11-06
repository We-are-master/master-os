/**
 * Checklist "Ready for job": o que o lead precisa ter para virar job no Won.
 * Puro, para a tela (drawer, card do board) e para o Harvey usarem igual.
 */
import type { Lead, Quote } from "@/types/database";

export type ItemDoChecklist = {
  key:
    | "client"
    | "address"
    | "ccz_parking"
    | "service"
    | "scope"
    | "date_window"
    | "client_price"
    | "partner_cost"
    | "deposit"
    | "ticket"
    | "account";
  label: string;
  ok: boolean;
  detail: string;
};

export type ContextoDoChecklist = {
  lead: Pick<
    Lead,
    | "client_id"
    | "address"
    | "postcode"
    | "in_ccz"
    | "has_free_parking"
    | "catalog_service_id"
    | "scope"
    | "preferred_date"
    | "preferred_window"
    | "price_given"
    | "price_mode"
    | "external_ref"
    | "account_id"
  >;
  /** A quote aceita (ou a mais recente) do lead, se houver. */
  quote?: Pick<Quote, "sell_price" | "total_value" | "partner_cost" | "cost" | "customer_deposit_paid" | "deposit_required" | "status"> | null;
  /** A conta não pede entrada (Housekeep, Express, Fantastic ou termos B2B). */
  semEntrada?: boolean;
  /** Pagamento de entrada confirmado fora da quote (ex.: Stripe do preço de handyman). */
  entradaPaga?: boolean;
};

const PRECO_COM_PRECO = /£\s?\d|\bGBP\b/i;

export function checklistDoJob(c: ContextoDoChecklist): ItemDoChecklist[] {
  const l = c.lead;
  const q = c.quote ?? null;
  const precoCliente = Number(q?.sell_price ?? q?.total_value ?? l.price_given ?? 0);
  const custoParceiro = Number(q?.partner_cost ?? q?.cost ?? 0);
  const temRua = !!l.address?.trim() && !!l.postcode?.trim();
  const scope = (l.scope ?? "").trim();
  const entradaOk = !!c.semEntrada || !!c.entradaPaga || !!q?.customer_deposit_paid || (!!q && Number(q.deposit_required ?? 0) === 0);

  return [
    { key: "client", label: "Client", ok: !!l.client_id, detail: l.client_id ? "linked" : "link or create the client" },
    { key: "address", label: "Address", ok: temRua, detail: temRua ? "complete" : "street and postcode" },
    {
      key: "ccz_parking",
      label: "CCZ · parking",
      ok: l.in_ccz != null && l.has_free_parking != null,
      detail: l.in_ccz != null && l.has_free_parking != null ? `${l.in_ccz ? "CCZ" : "not CCZ"} · ${l.has_free_parking ? "free parking" : "no free parking"}` : "ask the customer",
    },
    { key: "service", label: "Service", ok: !!l.catalog_service_id, detail: l.catalog_service_id ? "from the catalogue" : "pick one of the 14" },
    {
      key: "scope",
      label: "Scope",
      ok: scope.length >= 10 && !PRECO_COM_PRECO.test(scope),
      detail: !scope ? "write the scope" : PRECO_COM_PRECO.test(scope) ? "remove the price from the scope" : "no price",
    },
    {
      key: "date_window",
      label: "Date · window",
      ok: !!l.preferred_date && !!l.preferred_window?.trim(),
      detail: l.preferred_date && l.preferred_window ? `${l.preferred_date} · ${l.preferred_window}` : "confirm with the customer",
    },
    {
      key: "client_price",
      label: "Client price",
      ok: precoCliente > 0,
      detail: precoCliente > 0 ? `£${precoCliente.toFixed(2)}${q ? "" : ` · ${l.price_mode ?? "fixed"}`}` : "quote or price given",
    },
    {
      key: "partner_cost",
      label: "Partner cost",
      ok: custoParceiro > 0 || (!q && precoCliente > 0),
      detail: custoParceiro > 0 ? `£${custoParceiro.toFixed(2)}` : !q && precoCliente > 0 ? "from the handyman rule" : "pick a bid",
    },
    { key: "deposit", label: "Deposit", ok: entradaOk, detail: entradaOk ? (c.semEntrada ? "not needed for this account" : "paid") : "payment link not paid" },
    { key: "ticket", label: "Ticket", ok: !!l.external_ref, detail: l.external_ref ? `#${l.external_ref}` : "link the Zendesk ticket" },
    { key: "account", label: "Account", ok: !!l.account_id, detail: l.account_id ? "set" : "missing" },
  ];
}

export function prontoParaJob(itens: readonly { ok: boolean }[]): { pronto: boolean; faltam: number; total: number } {
  const faltam = itens.filter((i) => !i.ok).length;
  return { pronto: faltam === 0, faltam, total: itens.length };
}

/**
 * Checklist "Ready for quote" (06/11/2026, dono): o mínimo para pedir preço
 * (Partners bid casa por tipo de trabalho e área; a quote interna precisa do
 * scope). A equipe ou o Harvey preenchem e vai ficando verde.
 */
export type ItemDaQuote = { key: "contact" | "address" | "service" | "scope"; label: string; ok: boolean; detail: string };

export function checklistDaQuote(
  l: Pick<Lead, "phone" | "email" | "address" | "postcode" | "catalog_service_id" | "scope">,
): ItemDaQuote[] {
  const contato = !!String(l.phone ?? "").trim() || !!String(l.email ?? "").trim();
  const postcode = !!String(l.postcode ?? "").trim();
  const scope = String(l.scope ?? "").trim();
  return [
    { key: "contact", label: "Contact", ok: contato, detail: contato ? "phone or email" : "add a phone or email" },
    { key: "address", label: "Postcode", ok: postcode, detail: postcode ? String(l.postcode).toUpperCase() : "partners are matched by area" },
    { key: "service", label: "Service", ok: !!l.catalog_service_id, detail: l.catalog_service_id ? "from the catalogue" : "pick one of the 14" },
    {
      key: "scope",
      label: "Scope",
      ok: scope.length >= 10 && !PRECO_COM_PRECO.test(scope),
      detail: !scope ? "what the customer needs" : PRECO_COM_PRECO.test(scope) ? "remove the price from the scope" : scope.length < 10 ? "a bit more detail" : "no price",
    },
  ];
}
