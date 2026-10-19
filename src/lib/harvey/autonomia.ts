/**
 * O que o Harvey faz sozinho, ligado e desligado pela tela /agents/harvey (dono,
 * 19/10/2026: "quando eu quiser parar, coloca isso feito pelo app").
 *
 * Mora em harvey_wa_config, chave "autonomia", valor { geral, areas, tetoEnvio }.
 * Cada área tem três modos:
 *   on     → faz e manda;
 *   ensaio → decide e escreve a nota "eu faria", nada sai;
 *   off    → não faz nada (a equipe faz à mão).
 * "geral: false" é o botão Pausar tudo: todas as áreas e o WhatsApp param.
 *
 * A variável de ambiente continua sendo o teto: com ela desligada a área fica
 * no máximo em ensaio (ou off, onde não existe ensaio), nunca acima. Sem a linha
 * no banco vale o PADRAO, que repete o comportamento de antes da tela. Cache de
 * 30 s, como os ajustes e os blocos do prompt.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

export type ModoDeAutonomia = "off" | "ensaio" | "on";

export type AreaDeAutonomia = "cotacao" | "lances" | "envio" | "b2b_hora" | "perguntas" | "aceite";

export type Autonomia = {
  /** false = Pausar tudo. */
  geral: boolean;
  areas: Record<AreaDeAutonomia, ModoDeAutonomia>;
  /** Teto em £ do preço que sai sozinho para o cliente; null = o da variável (£600). */
  tetoEnvio: number | null;
};

export const CHAVE_DA_AUTONOMIA = "autonomia";

export const AREAS: AreaDeAutonomia[] = ["cotacao", "lances", "envio", "b2b_hora", "perguntas", "aceite"];

/** O que já existia segue como estava (a variável decide); o novo nasce em ensaio. */
export const PADRAO: Autonomia = {
  geral: true,
  areas: { cotacao: "on", lances: "on", envio: "on", b2b_hora: "ensaio", perguntas: "ensaio", aceite: "ensaio" },
  tetoEnvio: null,
};

const ORDEM: Record<ModoDeAutonomia, number> = { off: 0, ensaio: 1, on: 2 };
const menor = (a: ModoDeAutonomia, b: ModoDeAutonomia): ModoDeAutonomia => (ORDEM[a] <= ORDEM[b] ? a : b);
const ligada = (nome: string) => process.env[nome]?.trim() === "1";

/**
 * O teto que a variável de ambiente dá a cada área. Área sem variável: on.
 * Desligada, cotação e envio caem para ensaio (o quoter escreve quem convidaria,
 * a varredura deixa o rascunho); lances cai para off (sem a variável não lê nada).
 */
export function tetoDoAmbiente(area: AreaDeAutonomia): ModoDeAutonomia {
  if (process.env.HARVEY_PAUSADO?.trim() === "1") return "off";
  switch (area) {
    case "cotacao":
      return ligada("HARVEY_QUOTE_INVITES") ? "on" : "ensaio";
    case "lances":
      return ligada("HARVEY_RASCUNHO_LANCE") ? "on" : "off";
    case "envio":
      return ligada("HARVEY_QUOTE_AUTO_SEND") ? "on" : "ensaio";
    default:
      return "on";
  }
}

/** Normaliza o que veio do banco ou da tela; o que não presta vira o padrão. */
export function validarAutonomia(v: unknown): Autonomia {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ar = (o.areas && typeof o.areas === "object" ? o.areas : {}) as Record<string, unknown>;
  const modo = (x: unknown, d: ModoDeAutonomia): ModoDeAutonomia => (x === "off" || x === "ensaio" || x === "on" ? x : d);
  const teto = Number(o.tetoEnvio);
  return {
    geral: typeof o.geral === "boolean" ? o.geral : PADRAO.geral,
    areas: Object.fromEntries(AREAS.map((a) => [a, modo(ar[a], PADRAO.areas[a])])) as Autonomia["areas"],
    tetoEnvio: o.tetoEnvio != null && Number.isFinite(teto) && teto > 0 && teto <= 10_000 ? Math.round(teto) : null,
  };
}

/** O modo que vale de fato: Pausar tudo, depois o menor entre a tela e a variável. */
export function modoEfetivo(a: Autonomia, area: AreaDeAutonomia): ModoDeAutonomia {
  if (!a.geral) return "off";
  return menor(a.areas[area], tetoDoAmbiente(area));
}

export async function lerAutonomia(sb: SupabaseClient): Promise<Autonomia & { atualizado_em: string | null; atualizado_por: string | null }> {
  const { data } = await sb.from("harvey_wa_config").select("valor, atualizado_em, atualizado_por").eq("chave", CHAVE_DA_AUTONOMIA).maybeSingle();
  return { ...validarAutonomia(data?.valor), atualizado_em: (data?.atualizado_em as string | null) ?? null, atualizado_por: (data?.atualizado_por as string | null) ?? null };
}

let cache: { em: number; autonomia: Autonomia } | null = null;

/** O que os robôs usam. Falhou a leitura, segue com o último lido; nunca lido, tudo parado. */
export async function autonomia(): Promise<Autonomia> {
  if (cache && Date.now() - cache.em < 30_000) return cache.autonomia;
  try {
    const lida = validarAutonomia(await lerAutonomia(createServiceClient()));
    cache = { em: Date.now(), autonomia: lida };
    return lida;
  } catch (e) {
    console.error("[harvey] autonomia", e);
    return cache?.autonomia ?? { ...PADRAO, geral: false };
  }
}

/** O último valor lido, para quem não pode esperar (sem leitura ainda: tudo parado). */
export function autonomiaLida(): Autonomia {
  return cache?.autonomia ?? { ...PADRAO, geral: false };
}

export async function modoDe(area: AreaDeAutonomia): Promise<ModoDeAutonomia> {
  return modoEfetivo(await autonomia(), area);
}

/** O Harvey está ligado (ninguém apertou Pausar tudo)? */
export async function harveyLigado(): Promise<boolean> {
  if (process.env.HARVEY_PAUSADO?.trim() === "1") return false;
  return (await autonomia()).geral;
}

/** Para testes e para a tela, depois de salvar. */
export function esquecerAutonomia(): void {
  cache = null;
}
