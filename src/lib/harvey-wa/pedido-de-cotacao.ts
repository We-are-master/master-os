/**
 * As decisões do pedido de cotação no WhatsApp (Fase 1, dono 15/10/2026), sem rede.
 *
 *  - de onde vem o postcode: do que o cliente escreveu OU do cadastro do lead
 *    (Checkatrade, site, cliente do OS). Nunca do modelo: dois request_quote
 *    falharam porque o postcode estava no lead e não no chat;
 *  - o mínimo para chamar parceiro: descrição + postcode + fotos (ou o motivo);
 *  - em que pé está a cotação, em palavras que o Harvey diz ao cliente.
 */

/** "nw2 6xj" → "NW26XJ": só para comparar. */
export function postcodeNormal(p: unknown): string {
  return String(p ?? "").replace(/\s+/g, "").toUpperCase();
}

/** "NW26XJ" → "NW2 6XJ" (o formato que vai para a quote). */
function postcodeBonito(p: string): string {
  const n = postcodeNormal(p);
  return n.length > 4 ? `${n.slice(0, -3)} ${n.slice(-3)}` : n;
}

/**
 * O postcode da cotação. Vale o que o cliente escreveu no chat (pelo menos a
 * primeira metade) ou o que já está no cadastro do lead. Sem nenhum dos dois,
 * null: o Harvey pergunta. Com só a metade dita e o completo no cadastro, vale
 * o completo. Sem postcode na chamada e um só no cadastro, usa esse.
 */
export function postcodeDaCotacao(dado: unknown, textoDoCliente: string | null | undefined, conhecidos: readonly (string | null | undefined)[] = []): string | null {
  const pc = postcodeNormal(dado);
  const disse = postcodeNormal(textoDoCliente);
  const cadastro = [...new Set(conhecidos.map(postcodeNormal).filter((k) => k.length >= 2))];
  if (!pc) return cadastro.length === 1 ? postcodeBonito(cadastro[0]!) : null;
  // Mesma régua de antes: a primeira metade escrita pelo cliente basta.
  if (disse.includes(pc.slice(0, Math.max(3, pc.length - 3)))) {
    const completo = pc.length <= 4 ? cadastro.find((k) => k.startsWith(pc) && k.length > pc.length) : undefined;
    return postcodeBonito(completo ?? pc);
  }
  const doCadastro = cadastro.find((k) => k === pc) ?? (pc.length <= 4 ? cadastro.find((k) => k.startsWith(pc)) : undefined);
  return doCadastro ? postcodeBonito(doCadastro) : null;
}

/** O que falta para chamar os parceiros. Endereço, ocupação e prazo não seguram o convite. */
export function faltandoParaCotar(a: { descricao: unknown; postcode: string | null; fotos: number; semFotos: unknown }): string[] {
  const f: string[] = [];
  if (String(a.descricao ?? "").trim().length < 10) f.push("what exactly needs doing");
  if (!a.postcode) f.push("their postcode");
  if (a.fotos === 0 && !String(a.semFotos ?? "").trim()) f.push("a few photos or a short video of the job");
  return f;
}

export type SituacaoDaCotacao = "inviting" | "waiting_bids" | "priced" | "sent" | "closed";

/** Em que pé está, pelo status da quote no OS e pelo que os parceiros fizeram. */
export function situacaoDaCotacao(a: { status: string; convidados: number; lances: number }): SituacaoDaCotacao {
  if (["awaiting_customer", "awaiting_payment"].includes(a.status)) return "sent";
  if (["converted_to_job", "rejected", "lost", "cancelled", "expired"].includes(a.status)) return "closed";
  if (a.status === "quote_ready") return "priced";
  if (a.status === "bidding" && a.convidados > 0) return "waiting_bids";
  return "inviting";
}

/** O que o Harvey diz, simples, sem prometer hora. */
export function textoDaSituacao(s: SituacaoDaCotacao, a: { convidados: number; lances: number }): string {
  switch (s) {
    case "inviting":
      return "We're lining up the right professionals to price it.";
    case "waiting_bids":
      return a.lances > 0
        ? "Prices are coming in from the professionals. We check them and send the fixed price here."
        : `${a.convidados > 1 ? `${a.convidados} professionals are` : "A professional is"} pricing it now.`;
    case "priced":
      return "The price is in. We're doing a last check on it before it comes to you.";
    case "sent":
      return "The quote has been sent.";
    case "closed":
      return "This quote is closed.";
  }
}

/**
 * Hora do catálogo OU cotação de parceiro, nunca as duas (dono, 23/10/2026, QT-2026-1256).
 *
 * O suporte de bicicleta do Frede: o Harvey disse "a handyman hour is £72" e na
 * mensagem seguinte "I've sent it over for a fixed price", abriu a quote e convidou
 * 6 parceiros. O cliente ficou com dois preços na mão e a WHistyle cotou à toa.
 *
 * Já deu o preço do catálogo (nesta resposta, ou numa fala dele com £ e hora/dia):
 * o request_quote recusa. Volta a valer se o cliente pedir uma quote depois disso.
 */
const PRECO_POR_TEMPO = /£\s?\d[\d,.]*[^\n]{0,80}\b(hour|hourly|half[- ]day|full day|day rate)\b|\b(hour|hourly|half[- ]day|full day|day rate)\b[^\n]{0,80}£\s?\d/i;
const CLIENTE_PEDE_QUOTE = /\b(quote|fixed price|written price|estimate)\b/i;

export function precoDoCatalogoJaDado(conversa: ReadonlyArray<{ papel: string; texto: string }>, precoNestaResposta: boolean): boolean {
  if (precoNestaResposta) return true;
  let oferecido = false;
  for (const f of conversa) {
    if (f.papel === "harvey" && PRECO_POR_TEMPO.test(f.texto)) oferecido = true;
    else if (f.papel === "cliente" && oferecido && CLIENTE_PEDE_QUOTE.test(f.texto)) oferecido = false;
  }
  return oferecido;
}
