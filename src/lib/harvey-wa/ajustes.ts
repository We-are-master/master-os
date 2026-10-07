/**
 * Ajustes do Harvey que a equipe muda na tela /agents/harvey (dono, 07/10/2026:
 * "vira ajuste na tela"). Só o que é do Harvey: preço, depósito, datas e área
 * são do site e continuam no código, para o WhatsApp nunca cobrar diferente.
 *
 * Moram em harvey_wa_config, chave "ajustes", valor { janelaInicio, janelaFim,
 * cincoQuartos, transferencia }. Sem a linha, vale o PADRAO (o comportamento de
 * antes desta tela). Cache de 30 s, como os blocos do prompt.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

export type AjustesDoHarvey = {
  /** Hora de Londres em que o template de primeiro contato pode começar a sair. */
  janelaInicio: number;
  /** Hora de Londres a partir da qual o template não sai mais (exclusiva). */
  janelaFim: number;
  /** 5+ quartos: passa para a equipe (cotação por foto) ou cota pela tabela do site. */
  cincoQuartos: "equipe" | "tabela";
  /** Pedido de transferência bancária: passa para a equipe, ou só cartão. */
  transferencia: "equipe" | "so_cartao";
};

export const PADRAO: AjustesDoHarvey = { janelaInicio: 8, janelaFim: 20, cincoQuartos: "equipe", transferencia: "equipe" };

export const CHAVE_DOS_AJUSTES = "ajustes";

/** Normaliza o que veio do banco ou da tela; o que não presta vira o padrão. */
export function validarAjustes(v: unknown): AjustesDoHarvey {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const hora = (x: unknown, d: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 24 ? (x as number) : d);
  let janelaInicio = hora(o.janelaInicio, PADRAO.janelaInicio);
  let janelaFim = hora(o.janelaFim, PADRAO.janelaFim);
  if (janelaFim <= janelaInicio) [janelaInicio, janelaFim] = [PADRAO.janelaInicio, PADRAO.janelaFim];
  return {
    janelaInicio,
    janelaFim,
    cincoQuartos: o.cincoQuartos === "tabela" ? "tabela" : "equipe",
    transferencia: o.transferencia === "so_cartao" ? "so_cartao" : "equipe",
  };
}

export async function lerAjustes(sb: SupabaseClient): Promise<AjustesDoHarvey & { atualizado_em: string | null; atualizado_por: string | null }> {
  const { data } = await sb.from("harvey_wa_config").select("valor, atualizado_em, atualizado_por").eq("chave", CHAVE_DOS_AJUSTES).maybeSingle();
  return { ...validarAjustes(data?.valor), atualizado_em: (data?.atualizado_em as string | null) ?? null, atualizado_por: (data?.atualizado_por as string | null) ?? null };
}

let cache: { em: number; ajustes: AjustesDoHarvey } | null = null;

/** O que o Harvey e o ingest usam. Falhou a leitura, segue com o último lido (ou o padrão). */
export async function ajustesDoHarvey(): Promise<AjustesDoHarvey> {
  if (cache && Date.now() - cache.em < 30_000) return cache.ajustes;
  try {
    const lido = await lerAjustes(createServiceClient());
    const ajustes: AjustesDoHarvey = { janelaInicio: lido.janelaInicio, janelaFim: lido.janelaFim, cincoQuartos: lido.cincoQuartos, transferencia: lido.transferencia };
    cache = { em: Date.now(), ajustes };
    return ajustes;
  } catch (e) {
    console.error("[harvey-wa] ajustes", e);
    return cache?.ajustes ?? PADRAO;
  }
}

/** Agora (Londres) está dentro da janela dos templates? */
export function janelaAberta(a: Pick<AjustesDoHarvey, "janelaInicio" | "janelaFim">, agora: Date = new Date()): boolean {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(agora));
  return hora >= a.janelaInicio && hora < a.janelaFim;
}

/** O catálogo do site como o Harvey deve ler, com o ajuste dos 5+ quartos. */
export function catalogoComAjustes(catalogo: unknown, a: AjustesDoHarvey): unknown {
  if (a.cincoQuartos === "equipe" || !catalogo || typeof catalogo !== "object") return catalogo;
  const c = catalogo as { cleaning?: Record<string, unknown> };
  if (!c.cleaning) return catalogo;
  return { ...c, cleaning: { ...c.cleaning, fiveBedNote: "5+ bedrooms: quote the 5+ bedroom price from the table, like any other size" } };
}

/** O bloco que vai no fim do prompt do cliente: o ajuste vence o texto dos blocos. */
export function instrucoesDosAjustes(a: AjustesDoHarvey): string {
  const linhas: string[] = [];
  if (a.cincoQuartos === "tabela") {
    linhas.push("5+ bedrooms: quote the 5+ bedroom price from the catalogue like any other size. Do not pass them to the team just for the size.");
  }
  if (a.transferencia === "so_cartao") {
    linhas.push(
      'Bank transfer: we only take payment by the secure card link. If they ask to pay by bank transfer, say kindly in one line that payment is by card link only (50% now, 50% after the job) and carry on. Do not pass to the team for this.',
    );
  }
  return linhas.length ? `# Settings from the team (these override anything above)\n\n${linhas.join("\n")}` : "";
}
