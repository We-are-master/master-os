/**
 * Pedido B2B com informação faltando (dono, 20/10/2026: "B2B só pede o postcode sozinho;
 * medidas, acesso e fotos ficam para a equipe"). O quoter já lista o que um avaliador ainda
 * precisaria (`missingInfo`); aqui o modelo escolhe no máximo 3 perguntas que um parceiro
 * realmente precisa para dar preço, e uma resposta só sai no ticket, uma vez por ticket.
 * Área "perguntas" da tela de autonomia: on manda, ensaio só devolve a nota.
 */

import { chamarModeloJson, type ChamadaAoModelo } from "@/lib/quote-lance-escopo";
import { updateTicket } from "@/lib/zendesk";
import { conferirMensagem } from "@/lib/harvey/conferente";
import { autorDoAviso } from "./aviso-de-cotacao";
import type { ModoDeAutonomia } from "@/lib/harvey/autonomia";

export const TAG_PEDIU_INFO = "harvey_ask_info";

const SISTEMA = [
  "You help a UK maintenance company get a job priced by tradespeople. Below is what a surveyor would still want to know.",
  "Pick AT MOST 3 questions a tradesperson truly needs answered to give a price: sizes or quantities, access or parking, photos of the area, the specific material or product, anything that changes the price.",
  "Drop nice-to-haves (colour preferences, timelines, optional extras) and anything already answered in the request.",
  'Answer in strict JSON: {"questions":[string]}. Each question one short plain sentence in UK English, polite, no em dashes. Empty list if nothing is essential.',
].join("\n");

export function lerPerguntasJson(cru: string): string[] {
  try {
    const j = JSON.parse(String(cru ?? "").trim()) as { questions?: unknown };
    return (Array.isArray(j.questions) ? j.questions : [])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 5)
      .map((q) => q.replace(/\s*[—–]\s*/g, ", ").trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function textoDoPedidoDeInfo(primeiroNome: string | null, perguntas: string[]): string {
  const lista = perguntas.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `Hi ${primeiroNome?.trim() || "there"},\n\nTo make sure the price is right, could you confirm:\n${lista}\n\nPhotos of the area help a lot too. Thanks!\n\nKind regards,\nFixfy Team`;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = (t: string) => `<p>${esc(t).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;

/** Devolve a linha para a nota interna (null quando não há nada a perguntar). */
export async function pedirInfoQueFalta(a: {
  ticketId: number;
  tags: string[];
  pedido: string;
  faltando: string[];
  remetente: string | null;
  modo: ModoDeAutonomia;
  postar: boolean;
  chamar?: ChamadaAoModelo;
}): Promise<string | null> {
  if (a.modo === "off" || !a.faltando.length || a.tags.includes(TAG_PEDIU_INFO) || a.tags.includes("harvey_off")) return null;
  const perguntas = lerPerguntasJson(
    await (a.chamar ?? chamarModeloJson)(SISTEMA, `REQUEST:\n${a.pedido.slice(0, 2000)}\n\nSTILL MISSING:\n${a.faltando.map((f) => `- ${f}`).join("\n")}`),
  );
  if (!perguntas.length) return null;
  const primeiro = (a.remetente ?? "").trim().split(/\s+/)[0] || null;
  const conferido = conferirMensagem(textoDoPedidoDeInfo(primeiro, perguntas), { publico: "cliente" });
  if (!conferido.ok) return `── Missing info ──\nNot asked: the checker blocked it (${conferido.problemas.join("; ")}).`;
  if (a.modo !== "on" || !a.postar) return `── Missing info (DRY RUN, nothing sent) ──\nI would ask:\n${perguntas.map((q) => `- ${q}`).join("\n")}`;
  await updateTicket({ ticketId: a.ticketId, htmlBody: html(conferido.texto), publicComment: true, authorId: await autorDoAviso(), additionalTags: [TAG_PEDIU_INFO] });
  return `── Missing info ──\nAsked the customer:\n${perguntas.map((q) => `- ${q}`).join("\n")}`;
}
