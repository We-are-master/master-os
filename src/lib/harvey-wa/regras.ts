/**
 * As regras do OS (/rules) como o Harvey lê: o bloco do público dele, em
 * frases curtas, antes dos ajustes. Cache de 30 s (os-documentos). Sem regras
 * (tabela vazia ou erro), o prompt fica como era.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { versaoEmVigor, type PublicoDaRegra, type Regras } from "@/lib/os-documentos";
import { comoLista, soDoHarvey } from "@/lib/tabela-v2";

export async function textoDasRegras(publico: PublicoDaRegra): Promise<string> {
  const v = await versaoEmVigor<Regras>(createServiceClient(), "regras").catch(() => null);
  const lista = v?.documento.publicos[publico] ?? [];
  if (!lista.length) return "";
  return `# Rules (from the Fixfy OS: these are the facts, never contradict them)\n\n${lista.map((r) => `${r.titulo}: ${r.texto}`).join("\n")}`;
}

/**
 * Preços da lista que o site ainda não vende sozinho (handyman por hora,
 * call-out, semana, mês, serviços "other", extras fora da limpeza). O Harvey
 * cota exatamente estes e passa para a equipe fechar (não há link para eles).
 */
export async function textoDosPrecosSoDoHarvey(): Promise<string> {
  const v = await versaoEmVigor<unknown>(createServiceClient(), "tabela_de_precos").catch(() => null);
  const itens = v ? soDoHarvey(comoLista(v.documento)) : [];
  if (!itens.length) return "";
  return `# Other prices from the OS price list (not bookable by card link yet)\n\nQuote these exactly. To book any of them, take the details and pass to the team (hand_off_to_team) with the price: never create a payment link for them.\n${itens.join("\n")}`;
}
