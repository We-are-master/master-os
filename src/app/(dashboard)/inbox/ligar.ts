"use client";

/**
 * Call: abre a pessoa no Zendesk (o Talk disca de lá) e copia o número, para
 * colar no discador quando ela ainda não tem cadastro no Zendesk. A aba nasce
 * no clique (senão o navegador bloqueia) e recebe o endereço quando a busca volta.
 */

import { toast } from "sonner";

const ZENDESK = "https://fixfy.zendesk.com/agent/tickets/";

/**
 * Parceiro: abre o ticket de ligações dele. Sem ticket ainda, confirma antes
 * de criar (ticket novo só com ok de quem clica). Os outros: busca por telefone.
 */
export async function ligarPeloZendesk(numero: string, parceiro?: { id: string; ticket: string | null; nome: string }) {
  if (parceiro?.ticket) {
    void navigator.clipboard?.writeText(`+${numero}`).catch(() => {});
    window.open(`${ZENDESK}${parceiro.ticket}`, "_blank");
    return;
  }
  const criar = parceiro ? window.confirm(`${parceiro.nome} has no calls ticket in Zendesk yet. Create one now? It starts with an internal note, nothing is sent to the partner.`) : false;
  if (parceiro && !criar) return;
  const aba = window.open("about:blank", "_blank");
  void navigator.clipboard?.writeText(`+${numero}`).catch(() => {});
  try {
    const r = await fetch("/api/inbox/ligar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parceiro ? { numero, parceiroId: parceiro.id, criar: true } : { numero }),
    });
    const j = (await r.json().catch(() => ({}))) as { url?: string; achado?: boolean; nome?: string; error?: string; ticket?: string };
    if (!r.ok || !j.url) throw new Error(j.error ?? "Zendesk not reachable");
    if (aba) aba.location.href = j.url;
    else window.open(j.url, "_blank");
    if (j.ticket) {
      toast.success(`Calls ticket #${j.ticket} created for ${j.nome ?? "the partner"}.`);
      return;
    }
    toast.success(j.achado ? `Opened ${j.nome ?? "the contact"} in Zendesk. Click the number to call.` : `+${numero} copied. Paste it in the Talk dialer.`);
  } catch (e) {
    aba?.close();
    toast.error(e instanceof Error ? e.message : "Could not open Zendesk");
  }
}
