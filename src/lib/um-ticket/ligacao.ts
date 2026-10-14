/**
 * Ligação visível no pedido (dono, 14/10/2026). O Zendesk Talk abre um ticket
 * por ligação ("Call with ...", via voice, resolvido sozinho pelo gatilho
 * 6392605602207). A gravação mora nele, então NÃO se junta: o ticket aberto do
 * mesmo cliente ganha uma nota interna com o link da ligação. Puro.
 */

export type TicketDeLigacao = { id: number; requesterId: number; criadoEm: string; assunto: string; canal: string | null; tags: string[] };
export type TicketAberto = { id: number; requesterId: number; status: string; canal: string | null; atualizadoEm: string; tags: string[] };

/** Tag no ticket aberto que diz "esta ligação já está anotada aqui": vai no mesmo PUT da nota. */
export const tagDaLigacao = (callId: number): string => `call_${callId}`;

export type NotaDeLigacao = { ligacao: TicketDeLigacao; alvo: number };

/** Para cada ligação, o ticket aberto (não-voz) mais recente do mesmo solicitante que ainda não tem a nota. */
export function ligacoesParaAnotar(ligacoes: TicketDeLigacao[], abertos: TicketAberto[]): NotaDeLigacao[] {
  const porPessoa = new Map<number, TicketAberto[]>();
  for (const t of abertos) {
    if ((t.canal ?? "") === "voice" || !["new", "open", "pending", "hold"].includes(t.status) || t.tags.includes("partner")) continue;
    porPessoa.set(t.requesterId, [...(porPessoa.get(t.requesterId) ?? []), t]);
  }
  const out: NotaDeLigacao[] = [];
  for (const l of ligacoes) {
    if ((l.canal ?? "") !== "voice") continue;
    const alvo = (porPessoa.get(l.requesterId) ?? []).filter((t) => t.id !== l.id).sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0];
    if (!alvo || alvo.tags.includes(tagDaLigacao(l.id))) continue;
    out.push({ ligacao: l, alvo: alvo.id });
  }
  return out;
}

export function textoDaNotaDeLigacao(l: TicketDeLigacao, subdominio: string): string {
  const quando = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(l.criadoEm));
  const perdida = /^abandoned/i.test(l.assunto);
  return `📞 ${perdida ? "Missed call" : "Call"} with this customer on ${quando} (London): ticket #${l.id}${perdida ? "" : ", recording there"}. https://${subdominio}.zendesk.com/agent/tickets/${l.id}`;
}
