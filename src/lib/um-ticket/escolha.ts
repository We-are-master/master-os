/**
 * Qual ticket é "o do pedido" deste cliente (dono, 14/10/2026). Puro: quem
 * chama (achar.ts) junta os candidatos no Supabase e no Zendesk.
 *
 * Ordem:
 *  1. o ticket ligado ao job (jobs.external_ref)
 *  2. o ticket ligado à cotação (quotes.external_source = 'zendesk')
 *  3. um ticket ABERTO do cliente (pelo e-mail ou pelo telefone do WhatsApp)
 *
 * No 3 vale cautela: ligação (voz) não é pedido, ticket já ligado a OUTRO job é
 * outro pedido, e conta B2B costuma ter vários tickets abertos ao mesmo tempo
 * (Li & Fung: #49928 e #51028) — com mais de um, não chuta: devolve ambíguo e
 * quem chama faz o que fazia antes.
 */

export type OrigemDoTicket = "job" | "quote" | "cliente";

export type CandidatoDoPedido = {
  id: number;
  status: string; // new | open | pending | hold | solved | closed
  canal: string | null; // via.channel: email, api, web, whatsapp, voice, ...
  origem: OrigemDoTicket;
  atualizadoEm?: string | null;
  criadoEm?: string | null;
  tags?: string[];
  /** Já é o ticket de outro job (jobs.external_ref), não deste. */
  ligadoAOutroJob?: boolean;
};

export type EscolhaDoPedido =
  | { tipo: "ticket"; id: number; origem: OrigemDoTicket; canal: string | null; status: string }
  | { tipo: "ambiguo"; ids: number[] }
  | { tipo: "nenhum" };

const ABERTOS = new Set(["new", "open", "pending", "hold"]);

/** Canais de mensagem: um comentário público ali vai para o WhatsApp (ou chat), não para o e-mail. */
export function ehCanalDeMensagem(canal: string | null | undefined): boolean {
  const c = (canal ?? "").toLowerCase();
  return c === "whatsapp" || c === "native_messaging" || c === "chat" || c === "messaging" || c.startsWith("sunshine") || c === "instagram_dm" || c === "facebook";
}

/** Tickets que nunca são "o pedido": ligação, parceiro, ruído de plataforma já resolvido. */
function servePeloCliente(c: CandidatoDoPedido): boolean {
  if ((c.canal ?? "").toLowerCase() === "voice") return false;
  const tags = new Set(c.tags ?? []);
  if (tags.has("partner")) return false;
  return !c.ligadoAOutroJob;
}

export function escolherTicketDoPedido(
  candidatos: CandidatoDoPedido[],
  opcoes: { b2b?: boolean; exigirUnico?: boolean; excluir?: number[]; criadoAntesDe?: string | null } = {},
): EscolhaDoPedido {
  // Ensaio: tira o próprio ticket e o que nasceu depois do momento medido.
  const fora = new Set(opcoes.excluir ?? []);
  candidatos = candidatos.filter((c) => !fora.has(c.id) && (!opcoes.criadoAntesDe || !c.criadoEm || c.criadoEm < opcoes.criadoAntesDe));
  // 1 e 2: o vínculo explícito ganha, desde que o ticket aceite comentário (closed não aceita).
  for (const origem of ["job", "quote"] as const) {
    const ligado = candidatos.find((c) => c.origem === origem && c.status !== "closed" && c.status !== "deleted");
    if (ligado) return { tipo: "ticket", id: ligado.id, origem, canal: ligado.canal, status: ligado.status };
  }
  // 3: tickets abertos do cliente.
  const vistos = new Set<number>();
  const abertos = candidatos
    .filter((c) => c.origem === "cliente" && ABERTOS.has(c.status) && servePeloCliente(c))
    .filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)))
    .sort((a, b) => String(b.atualizadoEm ?? "").localeCompare(String(a.atualizadoEm ?? "")));
  if (abertos.length === 0) return { tipo: "nenhum" };
  if (abertos.length > 1 && (opcoes.b2b || opcoes.exigirUnico)) return { tipo: "ambiguo", ids: abertos.map((c) => c.id) };
  const t = abertos[0];
  return { tipo: "ticket", id: t.id, origem: "cliente", canal: t.canal, status: t.status };
}

export type ModoDeEntrega = "comentario_publico" | "conversa_lateral";

/**
 * Como o e-mail chega ao cliente dentro do ticket escolhido.
 *  - Comentário público quando o ticket é de e-mail/api/web E o solicitante é a
 *    pessoa que tem que receber: o Zendesk manda pelo canal do ticket.
 *  - Conversa lateral por e-mail, no MESMO ticket, quando:
 *     . o ticket é de WhatsApp: comentário público iria para o WhatsApp, que fora
 *       da janela de 24 h não entrega (foi por isso que o e-mail da Gifty abriu
 *       o #51286 em 13/10/2026);
 *     . o solicitante é outro (team@ dos tickets que o OS abre, o gerente da conta
 *       quando a fatura vai para o financeiro): o comentário iria para ele.
 */
export function modoDeEntrega(e: { canal: string | null; solicitante?: string | null; para: string }): ModoDeEntrega {
  if (ehCanalDeMensagem(e.canal)) return "conversa_lateral";
  const quem = (e.solicitante ?? "").trim().toLowerCase();
  return quem && quem === e.para.trim().toLowerCase() ? "comentario_publico" : "conversa_lateral";
}

/** E-mail que serve para achar o cliente no Zendesk (nada da casa, nada vazio). */
export function emailDoCliente(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  if (/@getfixfy\.com$/.test(e)) return null;
  return e;
}
