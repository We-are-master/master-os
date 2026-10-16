/**
 * O que o Harvey sabe e decide, editável pela equipe na tela /agents/harvey
 * (dono, 07/10/2026: "edição no front do que ele sabe, de forma simples").
 *
 * Cada bloco do prompt (prompt.ts) tem um texto padrão no código. A edição mora
 * em harvey_wa_config, chave "secao:<perfil>:<id>", valor { texto, anterior }:
 * texto editado vence o padrão, e "Reset to default" apaga a linha. Vale em até
 * 30 segundos, sem deploy. Preço não mora aqui: vem da tabela do site.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { secoesDo, type EdicoesDoPrompt, type PerfilDoHarvey } from "./prompt";

export const chaveDaSecao = (perfil: PerfilDoHarvey, id: string) => `secao:${perfil}:${id}`;

export type EdicaoSalva = { texto: string; anterior: string | null; atualizado_em: string; atualizado_por: string | null };

/** As edições de um perfil, com quem e quando editou (para a tela). */
export async function lerEdicoes(sb: SupabaseClient, perfil: PerfilDoHarvey): Promise<Record<string, EdicaoSalva>> {
  const { data, error } = await sb.from("harvey_wa_config").select("chave, valor, atualizado_em, atualizado_por").like("chave", `secao:${perfil}:%`);
  if (error) throw new Error(error.message);
  const ids = new Set(secoesDo(perfil).map((s) => s.id));
  const out: Record<string, EdicaoSalva> = {};
  for (const l of data ?? []) {
    const id = String(l.chave).slice(`secao:${perfil}:`.length);
    const v = l.valor as { texto?: unknown; anterior?: unknown } | null;
    if (!ids.has(id) || typeof v?.texto !== "string" || !v.texto.trim()) continue;
    out[id] = { texto: v.texto, anterior: typeof v.anterior === "string" ? v.anterior : null, atualizado_em: String(l.atualizado_em), atualizado_por: (l.atualizado_por as string | null) ?? null };
  }
  return out;
}

const cache = new Map<PerfilDoHarvey, { em: number; edicoes: EdicoesDoPrompt }>();
const VALIDADE_MS = 30_000;

/** O que o cérebro usa: só os textos, com cache curto. Falhou a leitura, segue com o padrão. */
export async function edicoesDoHarvey(perfil: PerfilDoHarvey): Promise<EdicoesDoPrompt> {
  const c = cache.get(perfil);
  if (c && Date.now() - c.em < VALIDADE_MS) return c.edicoes;
  try {
    const salvas = await lerEdicoes(createServiceClient(), perfil);
    const edicoes = Object.fromEntries(Object.entries(salvas).map(([id, e]) => [id, e.texto]));
    cache.set(perfil, { em: Date.now(), edicoes });
    return edicoes;
  } catch (e) {
    console.error("[harvey-wa] edições do prompt", e);
    return c?.edicoes ?? {};
  }
}
