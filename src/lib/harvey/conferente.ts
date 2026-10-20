/**
 * O conferente (B4, dono 20/10/2026: "sem errar"). Uma segunda leitura, sem modelo, de tudo
 * que o Harvey vai mandar sozinho a cliente ou parceiro. Achou problema: não manda, e quem
 * chama passa para a equipe com o motivo.
 *
 * Bloqueia:
 *  - ao cliente: custo do parceiro, margem, nome de parceiro, "bid" (é o nosso preço que ele vê);
 *  - preço menor ou igual ao custo, ou mais de 3x o custo (lance digitado errado);
 *  - destinatário nosso (@getfixfy.com);
 *  - texto vazio ou longo demais para uma mensagem.
 * Corrige sozinho: travessão vira vírgula (regra da casa).
 */

export type Conferencia = { ok: boolean; problemas: string[]; texto: string };

const libras = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const semCentavos = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function conferirMensagem(
  texto: string,
  a: { publico: "cliente" | "parceiro"; custo?: number | null; nomesDeParceiros?: string[]; emailDestino?: string | null },
): Conferencia {
  const problemas: string[] = [];
  const limpo = String(texto ?? "").replace(/\s*[—–]\s*/g, ", ").trim();
  if (limpo.length < 5) problemas.push("empty message");
  if (limpo.length > 3500) problemas.push("message too long");
  if (a.emailDestino && /@getfixfy\.com\s*$/i.test(a.emailDestino.trim())) problemas.push("recipient is a Fixfy address");

  if (a.publico === "cliente") {
    if (/\bmargin\b|\bmark-?up\b|\bpartner (cost|price)\b|\btheir (bid|price) (was|is)\b/i.test(limpo)) problemas.push("mentions margin or the partner's price");
    if (/\bbids?\b/i.test(limpo)) problemas.push('uses "bid" with the customer');
    if (a.custo && a.custo > 0) {
      const c = [libras(a.custo), semCentavos(a.custo)];
      if (c.some((v) => limpo.includes(v))) problemas.push("shows the partner's cost");
    }
    for (const nome of a.nomesDeParceiros ?? []) {
      const n = nome.trim();
      if (n.length >= 4 && limpo.toLowerCase().includes(n.toLowerCase())) problemas.push(`names the partner (${n})`);
    }
  }
  return { ok: problemas.length === 0, problemas, texto: limpo };
}

/** O preço ao cliente faz sentido com o custo? */
export function conferirPreco(a: { total: number; custo?: number | null; piso?: number | null }): Conferencia {
  const problemas: string[] = [];
  if (!(a.total > 0)) problemas.push("no price");
  if (a.custo && a.custo > 0) {
    if (a.total <= a.custo) problemas.push(`price ${libras(a.total)} is not above the partner cost ${libras(a.custo)}`);
    if (a.total > a.custo * 3) problemas.push(`price ${libras(a.total)} is more than 3x the partner cost ${libras(a.custo)}: check the bid`);
  }
  if (a.piso && a.total < a.piso - 0.01) problemas.push(`price ${libras(a.total)} is below the account's agreed ${libras(a.piso)}`);
  return { ok: problemas.length === 0, problemas, texto: "" };
}
