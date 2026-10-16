/**
 * Confirmação atrasada: o job futuro que já tem parceiro e nunca confirmou nada
 * ao cliente.
 *
 * Medido em 14/10/2026: 47 jobs agendados nas últimas duas semanas, 0 com
 * `client_confirmation_sent_at`. Três causas juntas: a trava geral voltava sem
 * gravar motivo, o disparo era `void` (morre na Vercel) e o aceite só
 * confirmava quando a side conversation do parceiro dava certo. As três estão
 * consertadas na hora da atribuição; esta varredura pega quem ficou para trás
 * e qualquer caminho de atribuição que ainda não chame a confirmação.
 *
 * Só olha jobs de AMANHÃ em diante. Hoje já é dia de visita: a confirmação
 * chegaria com o profissional na porta, e o lembrete de véspera já cobriu quem
 * tinha que cobrir. Job com lembrete de véspera já enviado também fica de fora
 * (uma mensagem por noite).
 *
 * Quem decide cada job continua sendo `enviarConfirmacaoDoCliente`: parceiro,
 * status, política da conta (Li & Fung e Fantastic não recebem), telefone,
 * trava de envio único. Aqui só se escolhe quem perguntar.
 *
 * Ensaio por padrão, e o ensaio não grava nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { amanhaEmLondres, horaEmLondres } from "./sweep-24h";
import { enviarConfirmacaoDoCliente, STATUS_CONFIRMAVEIS, type EnvioWhatsApp } from "./send";
import { mensagensAoClienteLigadas } from "./policy";

export type LinhaDaRecuperacao = {
  reference: string;
  dia: string;
  resultado: "enviado" | "pulado" | "falhou" | "enviaria";
  detalhe: string;
};

/** Mensagem automática ao cliente só de dia, no relógio de Londres. */
export const RECUPERACAO_HORA_INICIO = 9;
export const RECUPERACAO_HORA_FIM = 20;

export function dentroDaJanelaDaRecuperacao(agora: Date): boolean {
  const h = horaEmLondres(agora);
  return h >= RECUPERACAO_HORA_INICIO && h < RECUPERACAO_HORA_FIM;
}

/** Ensaio devolve "dry run: would send ..."; isso é um "enviaria", não um pulo. */
export function classificarEnsaio(motivo: string): "enviaria" | "pulado" {
  return /^dry run: would send/.test(motivo) ? "enviaria" : "pulado";
}

export async function recuperarConfirmacoes(
  supabase: SupabaseClient,
  opcoes?: { aplicar?: boolean; agora?: Date; max?: number; ignorarJanela?: boolean; enviar?: EnvioWhatsApp },
): Promise<{ desde: string; linhas: LinhaDaRecuperacao[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const agora = opcoes?.agora ?? new Date();
  const desde = amanhaEmLondres(agora);

  let aviso: string | null = null;
  let aplicar = opcoes?.aplicar === true;
  if (aplicar && !mensagensAoClienteLigadas()) {
    aviso = "CLIENT_MESSAGING_ENABLED is not 1: listing only";
    aplicar = false;
  }
  if (aplicar && !opcoes?.ignorarJanela && !dentroDaJanelaDaRecuperacao(agora)) {
    aviso = `outside ${RECUPERACAO_HORA_INICIO}h-${RECUPERACAO_HORA_FIM}h London (now ${horaEmLondres(agora)}h): listing only`;
    aplicar = false;
  }

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, reference, scheduled_date")
    .gte("scheduled_date", desde)
    .in("status", STATUS_CONFIRMAVEIS)
    .not("partner_id", "is", null)
    .is("client_confirmation_sent_at", null)
    .is("client_reminder_sent_at", null)
    .is("deleted_at", null)
    .order("scheduled_date")
    .limit(500);
  // Erro de consulta NÃO vira "nenhum job" (mesma lição do sweep-24h).
  if (error) throw new Error(`could not read jobs waiting for confirmation: ${error.message}`);

  const linhas: LinhaDaRecuperacao[] = [];
  let enviados = 0;
  const max = opcoes?.max ?? 40;
  for (const raw of jobs ?? []) {
    const j = raw as { id: string; reference: string; scheduled_date: string };
    const anota = (resultado: LinhaDaRecuperacao["resultado"], detalhe: string) =>
      linhas.push({ reference: j.reference, dia: j.scheduled_date, resultado, detalhe });

    if (aplicar && enviados >= max) {
      anota("pulado", `run cap reached (${max}): next run`);
      continue;
    }
    try {
      const r = await enviarConfirmacaoDoCliente(supabase, j.id, {
        simular: !aplicar,
        agora,
        enviar: opcoes?.enviar,
      });
      if (r.estado === "enviado") {
        enviados++;
        anota("enviado", r.telefone);
      } else if (r.estado === "falhou") {
        anota("falhou", r.motivo);
      } else {
        anota(aplicar ? "pulado" : classificarEnsaio(r.motivo), r.motivo);
      }
    } catch (e) {
      anota("falhou", e instanceof Error ? e.message.slice(0, 160) : String(e));
    }
  }
  return { desde, linhas, modo: aplicar ? "envio" : "ensaio", aviso };
}
