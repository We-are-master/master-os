/**
 * O pedido do Checkatrade no topo do ticket que fica depois do merge (dono,
 * 14/10/2026). O ticket do lead abre com a ficha "NEW CHECKATRADE LEAD"
 * (primeiro-contato.ts → abrirTicketDoLead); quando ele entra no ticket da
 * conversa do WhatsApp, a nota do merge passa a levar o resumo dessa ficha,
 * para quem abrir o ticket ver o pedido sem procurar o ticket fechado.
 *
 * Funções puras: lê o texto do primeiro comentário e monta a nota (em inglês,
 * é o que a equipe lê no Zendesk; sem travessão).
 */

export type ResumoDoLead = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  postcode: string | null;
  servico: string | null;
  /** "General Maintenance", da linha "Enquiry · ...". */
  categoria: string | null;
  /** O que o cliente escreveu no Checkatrade. */
  pedido: string | null;
  /** "as soon as possible (it's urgent)", "flexible on the start date". */
  urgencia: string | null;
  linkOs: string | null;
  leadId: string | null;
  conta: string | null;
};

const vazio = (v: string | undefined | null): string | null => {
  const t = (v ?? "").trim();
  return t && t !== "-" ? t : null;
};

function campo(linhas: string[], rotulo: string): string | null {
  const l = linhas.find((x) => x.toLowerCase().startsWith(`${rotulo.toLowerCase()}:`));
  return l ? vazio(l.slice(rotulo.length + 1)) : null;
}

/** null quando o texto não é a ficha de um lead do Checkatrade. */
export function lerFichaDoLead(texto: string | null | undefined): ResumoDoLead | null {
  if (!texto || !/NEW CHECKATRADE LEAD/i.test(texto)) return null;
  // O Checkatrade às vezes manda "\n" literal no meio do pedido.
  const linhas = texto.replace(/\\n/g, "\n").split(/\r?\n/).map((l) => l.trim());

  const ini = linhas.findIndex((l) => /^what they asked for:?$/i.test(l));
  const fim = linhas.findIndex((l, i) => i > ini && /^OS contact:/i.test(l));
  const bloco = ini >= 0 ? linhas.slice(ini + 1, fim > ini ? fim : undefined) : [];

  let categoria: string | null = null;
  let urgencia: string | null = null;
  const pedido: string[] = [];
  for (const l of bloco) {
    if (!l || /^checkatrade-account:/i.test(l)) continue;
    const enq = l.match(/^Enquiry\s*[·:-]\s*(.+)$/i);
    if (enq) { categoria = vazio(enq[1]); continue; }
    const urg = l.match(/^The customer (?:is|would|wants|needs|has)\b(.*)$/i);
    if (urg) {
      urgencia = l
        .replace(/^The customer (?:would ideally like the job to start|is|wants the job to start|needs the job to start)\s*/i, "")
        .replace(/\.$/, "")
        .trim() || l;
      continue;
    }
    pedido.push(l);
  }

  return {
    nome: campo(linhas, "Name"),
    telefone: campo(linhas, "Phone"),
    email: campo(linhas, "Email"),
    postcode: campo(linhas, "Postcode"),
    servico: campo(linhas, "Service"),
    categoria,
    pedido: /^\(no message\)$/i.test(pedido.join(" ").trim()) ? null : vazio(pedido.join(" ").replace(/\s+/g, " ")),
    urgencia,
    linkOs: campo(linhas, "OS contact"),
    leadId: campo(linhas, "Checkatrade lead id"),
    conta: campo(linhas, "Checkatrade account"),
  };
}

const LIMITE_DO_PEDIDO = 900;

/** A nota interna do merge, com o pedido em cima. */
export function notaDoMerge(leadTicketId: number, r: ResumoDoLead | null, textoCru?: string | null): string {
  const cabeca = `Lead ticket #${leadTicketId} (first contact, template sent) merged here.`;
  if (!r) {
    // Ficha fora do padrão: vai o começo do primeiro comentário, para não perder o pedido.
    const cru = (textoCru ?? "").trim();
    return cru ? `${cabeca}\n\nOriginal request (first comment of #${leadTicketId}):\n${cru.slice(0, LIMITE_DO_PEDIDO)}` : cabeca;
  }
  const pedido = r.pedido && r.pedido.length > LIMITE_DO_PEDIDO ? `${r.pedido.slice(0, LIMITE_DO_PEDIDO)}...` : r.pedido;
  const servico = [r.servico, r.categoria && r.categoria.toLowerCase() !== (r.servico ?? "").toLowerCase() ? `(${r.categoria})` : null].filter(Boolean).join(" ");
  return [
    "CHECKATRADE REQUEST",
    "",
    `Service: ${servico || "-"}`,
    `Postcode: ${r.postcode ?? "-"}`,
    `Urgency: ${r.urgencia ?? "-"}`,
    `Customer: ${[r.nome, r.telefone, r.email].filter(Boolean).join(" · ") || "-"}`,
    "",
    "What they asked for:",
    pedido ?? "(no message)",
    "",
    `OS contact: ${r.linkOs ?? "-"}`,
    `Checkatrade lead id: ${r.leadId ?? "-"}${r.conta ? ` (account: ${r.conta})` : ""}`,
    "",
    cabeca,
  ].join("\n");
}
