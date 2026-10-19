/**
 * Um classificador só para todo pedido que chega (dono, 19/10/2026): "lead chega, ele
 * classifica; se for por hora já vende; se for quote já classifica e manda para todos".
 *
 * Tipo: sempre um nome do catálogo. Primeiro o nome que veio (do LLM, do pricebook, do
 * formulário); se ele não diz nada (cai no padrão), a descrição decide. Assim
 * "Handyman_time" + "lightly sand the painted walls" vira Painter, e "Plasterer" vira
 * Builder sem a descrição ("…painting optional") puxar para Painter.
 *
 * Modo: "cotacao" quando o serviço do catálogo é só-cotação (sem preço fixo nem por hora)
 * ou o pedido tem cara de obra; "hora" quando o serviço vende por hora e o pedido cabe
 * em hora, meia diária ou diária; "fixo" para serviço de preço fechado (limpezas, certificados).
 */
import { tipoDoCatalogo } from "@/lib/tipo-de-trabalho";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

const PADRAO = "General Maintenance";

export type ServicoDoCatalogo = {
  id?: string | null;
  name: string;
  pricing_mode?: string | null;
  fixed_price?: number | null;
  hourly_rate?: number | null;
  accepts_smart_price?: boolean | null;
};

export type ModoDeVenda = "hora" | "cotacao" | "fixo";

export type Classificacao = {
  tipo: string;
  catalogServiceId: string | null;
  modo: ModoDeVenda;
  horasEstimadas: number | null;
  motivo: string;
};

/** Obra, projeto ou serviço que não cabe num dia de handyman: vai para os parceiros cotarem. */
const OBRA =
  /\b(renovat|refurbish|refit|install(ation)? of (a )?(new )?(kitchen|bathroom)|new (kitchen|bathroom)|bathroom (fit|install|renovat)|kitchen (fit|install|renovat)|extension|loft|rewire|re-?plaster|plasterboard|skim(ming)?|ceiling (repair|replace|collapse)|flood|insurance work|subsidence|damp proof|tanking|flooring (install|fit)|lay(ing)? (a )?(new )?floor|tiling (a|the) (whole|entire)|roof|chimney|whole (house|flat)|entire (house|flat)|(3|three|4|four|5|five) (rooms|bedrooms)|several rooms|multiple rooms|wet ?room|worktop replace|stone worktop)\b/i;

/** Horas que o pedido anuncia ("about 3 hours", "half a day", "full day"). */
export function horasDoTexto(texto: string): number | null {
  const t = texto.toLowerCase();
  if (/full day|whole day|for the day\b|\b7\s*(hrs?|hours?)\b/.test(t)) return 7;
  if (/half[\s-]?a?[\s-]?day|\b3\.5\s*(hrs?|hours?)\b/.test(t)) return 3.5;
  const m = t.match(/\b(?:about|around|approx(?:imately)?|roughly|~)?\s*(\d{1,2}(?:\.\d)?)\s*(?:-|to)?\s*(?:\d{1,2}\s*)?(hrs?|hours?)\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 24) return n;
  }
  return null;
}

/** Nome do catálogo: o nome que veio, e só se ele não disser nada, a descrição. */
export function tipoDoPedido(servico: string | null | undefined, descricao: string | null | undefined, catalogo: readonly string[]): string {
  const bruto = String(servico ?? "").replace(/_/g, " ").trim();
  const peloNome = tipoDoCatalogo(normalizeTypeOfWork(bruto).trim() || bruto, catalogo);
  // "Handyman", "Handyman_time": não dizem o ofício, a descrição decide. Só "General Maintenance" escrito é escolha.
  const nomeDizAlgo = peloNome !== PADRAO || /general maintenance/i.test(bruto);
  if (nomeDizAlgo || !descricao?.trim()) return peloNome;
  return tipoDoCatalogo(descricao, catalogo);
}

export function classificarPedido(
  entrada: { servico?: string | null; descricao?: string | null },
  catalogo: readonly ServicoDoCatalogo[],
): Classificacao {
  const nomes = catalogo.map((c) => String(c.name).trim()).filter(Boolean);
  const tipo = tipoDoPedido(entrada.servico, entrada.descricao, nomes);
  const svc = catalogo.find((c) => c.name.trim().toLowerCase() === tipo.toLowerCase()) ?? null;
  const texto = `${entrada.servico ?? ""} ${entrada.descricao ?? ""}`;
  const horas = horasDoTexto(texto);

  const soCotacao = svc ? !(Number(svc.fixed_price) > 0) && !(Number(svc.hourly_rate) > 0) && !svc.accepts_smart_price : false;
  const vendePorHora = svc ? svc.pricing_mode === "hourly" || svc.accepts_smart_price === true : tipo === PADRAO;

  let modo: ModoDeVenda;
  let motivo: string;
  if (OBRA.test(texto)) {
    modo = "cotacao";
    motivo = "project-type work: partners price it";
  } else if (soCotacao) {
    modo = "cotacao";
    motivo = `${tipo} is quote-only in the catalog`;
  } else if (vendePorHora && (horas == null || horas <= 7)) {
    modo = "hora";
    motivo = horas ? `fits in hours (about ${horas}h)` : "small job, sold by the hour";
  } else if (vendePorHora) {
    modo = "cotacao";
    motivo = `more than a day of work (${horas}h)`;
  } else {
    modo = "fixo";
    motivo = `${tipo} has a fixed price in the catalog`;
  }
  return { tipo, catalogServiceId: svc?.id ?? null, modo, horasEstimadas: horas, motivo };
}
