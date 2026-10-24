/**
 * Papéis da equipe: quem responde por cada coisa, como ajuste e não como pessoa no
 * código (dono, 15/10/2026: "pensar como empresa que vai contratar mais gente").
 *
 *   operacao             dono de reclamação e de assunto de operação (Needs Attention)
 *   autor_emails         quem assina os e-mails de chase (quote e lead); o Zendesk põe a assinatura dele
 *   autor_aviso_cotacao  quem assina o aviso "we're working on a quote" e a cotação automática por e-mail
 *   vendas               dono do ticket de lead e cotação (Lead, To Call, Needs Quote, Sourcing, No bids, Ready to send, Awaiting approval, Awaiting deposit)
 *   financeiro           dono do ticket de cobrança (Awaiting payment, Overdue, Payment failed)
 *
 * O dono do ticket por etapa (zendesk-espelho.ts, dono 23/10/2026): vendas até virar
 * job, operacao do job e da reclamação, financeiro da cobrança.
 *
 * Moram em harvey_wa_config, chave "equipe:papeis", valor { papel: { zendesk_user_id, nome } }.
 * Sem a linha, vale a variável de ambiente de antes e depois o usuário de sempre: nada
 * muda até alguém editar em /agents/harvey. Cache de 60 s.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

export type PapelDaEquipe = "operacao" | "autor_emails" | "autor_aviso_cotacao" | "vendas" | "financeiro";
export type Responsavel = { zendesk_user_id: number; nome: string };
export type PapeisDaEquipe = Record<PapelDaEquipe, Responsavel>;

export const CHAVE_DOS_PAPEIS = "equipe:papeis";
export const PAPEIS: PapelDaEquipe[] = ["operacao", "autor_emails", "autor_aviso_cotacao", "vendas", "financeiro"];

/** O usuário do Zendesk que já fazia os três papéis antes deste ajuste. */
const USUARIO_DE_SEMPRE: Responsavel = { zendesk_user_id: 6227542863391, nome: "Leonardo Piovesan" };

/** Vendas e financeiro nasceram com o dono (23/10/2026): os triggers antigos do Zendesk já davam Finance a ele. */
const DONO_DA_CASA: Responsavel = { zendesk_user_id: 5679223041823, nome: "Victor Braz" };

/** A variável de ambiente que cada papel lia antes. */
const ENV_DO_PAPEL: Record<PapelDaEquipe, string> = {
  operacao: "ZENDESK_OPS_AGENT_ID",
  autor_emails: "HARVEY_EMAIL_AUTHOR_ID",
  autor_aviso_cotacao: "HARVEY_AVISO_AUTOR_ID",
  vendas: "ZENDESK_SALES_AGENT_ID",
  financeiro: "ZENDESK_FINANCE_AGENT_ID",
};

/** De quem é o papel quando nada foi configurado. */
const PADRAO_DO_PAPEL: Record<PapelDaEquipe, Responsavel> = {
  operacao: USUARIO_DE_SEMPRE,
  autor_emails: USUARIO_DE_SEMPRE,
  autor_aviso_cotacao: USUARIO_DE_SEMPRE,
  vendas: DONO_DA_CASA,
  financeiro: DONO_DA_CASA,
};

const idValido = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** O padrão de cada papel: env, depois o usuário de sempre. Com id de env diferente, o nome fica genérico. */
export function papeisPadrao(env: Record<string, string | undefined> = process.env): PapeisDaEquipe {
  const um = (papel: PapelDaEquipe): Responsavel => {
    const padrao = PADRAO_DO_PAPEL[papel];
    const id = idValido(env[ENV_DO_PAPEL[papel]]);
    if (!id || id === padrao.zendesk_user_id) return { ...padrao };
    return { zendesk_user_id: id, nome: "Fixfy Team" };
  };
  return Object.fromEntries(PAPEIS.map((p) => [p, um(p)])) as PapeisDaEquipe;
}

/** Normaliza o que veio do banco ou da tela; papel sem id válido fica no padrão. */
export function validarPapeis(v: unknown, padrao: PapeisDaEquipe = papeisPadrao()): PapeisDaEquipe {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...padrao };
  for (const papel of PAPEIS) {
    const p = (o[papel] && typeof o[papel] === "object" ? o[papel] : {}) as Record<string, unknown>;
    const id = idValido(p.zendesk_user_id);
    if (!id) continue;
    const nome = typeof p.nome === "string" && p.nome.trim() ? p.nome.trim().slice(0, 80) : "Fixfy Team";
    out[papel] = { zendesk_user_id: id, nome };
  }
  return out;
}

export async function lerPapeis(sb: SupabaseClient): Promise<PapeisDaEquipe & { atualizado_em: string | null; atualizado_por: string | null }> {
  const { data } = await sb.from("harvey_wa_config").select("valor, atualizado_em, atualizado_por").eq("chave", CHAVE_DOS_PAPEIS).maybeSingle();
  return { ...validarPapeis(data?.valor), atualizado_em: (data?.atualizado_em as string | null) ?? null, atualizado_por: (data?.atualizado_por as string | null) ?? null };
}

let cache: { em: number; papeis: PapeisDaEquipe } | null = null;

/** O que o código usa. Falhou a leitura, segue com o último lido (ou o padrão). */
export async function papeisDaEquipe(): Promise<PapeisDaEquipe> {
  if (cache && Date.now() - cache.em < 60_000) return cache.papeis;
  try {
    const { data, error } = await createServiceClient().from("harvey_wa_config").select("valor").eq("chave", CHAVE_DOS_PAPEIS).maybeSingle();
    if (error) throw error;
    const papeis = validarPapeis(data?.valor);
    cache = { em: Date.now(), papeis };
    return papeis;
  } catch (e) {
    console.error("[papeis] leitura falhou, segue com o padrão:", e instanceof Error ? e.message : e);
    return cache?.papeis ?? papeisPadrao();
  }
}

/** Quem faz este papel agora. */
export async function responsavel(papel: PapelDaEquipe): Promise<Responsavel> {
  return (await papeisDaEquipe())[papel];
}

/** Ids que já fizeram o papel (o atual e o padrão): para reconhecer comentário antigo de quem assinava antes. */
export async function idsDoPapel(papel: PapelDaEquipe): Promise<number[]> {
  const atual = (await responsavel(papel)).zendesk_user_id;
  const padrao = papeisPadrao()[papel].zendesk_user_id;
  return atual === padrao ? [atual] : [atual, padrao];
}
