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
  /** Vindo de um lead do CRM (Mark won sem quote): o resto do job já combinado. */
  job?: PrefillDoJob | null;
};

/** Campos do New Job que o lead já sabe (mig 356). Tudo opcional. */
export type PrefillDoJob = {
  leadId?: string | null;
  catalog_service_id?: string | null;
  scheduled_date?: string | null;
  /** "HH:MM" */
  arrival_from?: string | null;
  arrival_window_mins?: number | null;
  job_kind?: "one_off" | "multi_day" | "recurring" | null;
  job_type?: "fixed" | "hourly" | null;
  rate_basis?: "fixed" | "daily" | "half_day" | null;
  client_price?: number | null;
  hourly_client_rate?: number | null;
  in_ccz?: boolean | null;
  has_free_parking?: boolean | null;
};

/** "08:00-10:00", "8-10", "08:00 to 10:00" → início e minutos de janela. */
export function janelaDoTexto(texto: string | null | undefined): { from: string; mins: number } | null {
  const m = String(texto ?? "").match(/(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to|até)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (!m) return null;
  const ini = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const fim = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (!(fim > ini) || ini >= 24 * 60) return null;
  const hh = String(Math.floor(ini / 60)).padStart(2, "0");
  const mm = String(ini % 60).padStart(2, "0");
  return { from: `${hh}:${mm}`, mins: fim - ini };
}

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
    return { cliente: p.cliente, scope: String(p.scope ?? ""), ticketId: p.ticketId ?? null, contaId: p.contaId ?? null, job: p.job ?? null };
  } catch {
    return null;
  }
}
