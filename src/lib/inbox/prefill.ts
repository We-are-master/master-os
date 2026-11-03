/**
 * A ponte da conversa para os formulários de verdade. A Inbox não tem um
 * "criar job" próprio: ela guarda o que tirou da conversa (cliente, endereço,
 * scope, ticket) e abre /jobs ou /quotes com `?new=inbox`. A página lê uma vez
 * e abre o mesmo modal de sempre já preenchido, com preço, duplicados e
 * Zendesk do jeito que o OS já faz. Fica na sessionStorage, nunca na URL,
 * porque leva nome e endereço do cliente.
 */

import type { ClientAndAddressValue } from "@/components/ui/client-address-picker";

export type PrefillDaConversa = {
  cliente: ClientAndAddressValue;
  scope: string;
  ticketId: string | null;
  /** Conta do cliente (`clients.source_account_id`): a cotação começa por ela. */
  contaId: string | null;
};

export type TipoDoPrefill = "job" | "quote";

const chave = (tipo: TipoDoPrefill) => `fixfy:prefill-da-conversa:${tipo}`;

export function guardarPrefill(tipo: TipoDoPrefill, p: PrefillDaConversa): void {
  try {
    sessionStorage.setItem(chave(tipo), JSON.stringify(p));
  } catch {
    /* sem sessionStorage o formulário só abre vazio */
  }
}

/** Lê e apaga: o mesmo preenchimento não volta ao recarregar a página. */
export function lerPrefill(tipo: TipoDoPrefill): PrefillDaConversa | null {
  try {
    const bruto = sessionStorage.getItem(chave(tipo));
    sessionStorage.removeItem(chave(tipo));
    if (!bruto) return null;
    const p = JSON.parse(bruto) as Partial<PrefillDaConversa>;
    if (!p.cliente) return null;
    return { cliente: p.cliente, scope: String(p.scope ?? ""), ticketId: p.ticketId ?? null, contaId: p.contaId ?? null };
  } catch {
    return null;
  }
}
