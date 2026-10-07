/**
 * As regras do OS (/rules) como o Harvey lê: o bloco do público dele, em
 * frases curtas, antes dos ajustes. Cache de 30 s (os-documentos). Sem regras
 * (tabela vazia ou erro), o prompt fica como era.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { versaoEmVigor, type PublicoDaRegra, type Regras } from "@/lib/os-documentos";

export async function textoDasRegras(publico: PublicoDaRegra): Promise<string> {
  const v = await versaoEmVigor<Regras>(createServiceClient(), "regras").catch(() => null);
  const lista = v?.documento.publicos[publico] ?? [];
  if (!lista.length) return "";
  return `# Rules (from the Fixfy OS: these are the facts, never contradict them)\n\n${lista.map((r) => `${r.titulo}: ${r.texto}`).join("\n")}`;
}

