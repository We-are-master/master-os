/**
 * Job B2C concluído resolve a conversa do cliente na /inbox (dono, 10/11/2026:
 * "a conversa do cliente no OS, quando finaliza um trabalho, já finaliza também?").
 *
 * Quando o job vira `completed`, a conversa do 7983 com o cliente vai para
 * Resolved, como o botão "Resolve" da tela. Ela reabre sozinha se o cliente
 * escrever depois (a tela compara com a última entrada), então nada se perde.
 *
 * Não resolve quando:
 *  - o job é de conta B2B (só conta Fixfy ou conta de cliente direto);
 *  - o cliente tem outro job em andamento (a conversa ainda é sobre ele);
 *  - o cliente escreveu DEPOIS de o trabalho terminar (tem coisa a responder);
 *  - a conversa já foi resolvida depois da conclusão, arquivada ou excluída.
 *
 * Roda no ciclo do /api/cron/harvey-wa (10 min) e olha jobs mexidos nos últimos
 * 3 dias, para a primeira rodada não fechar o histórico inteiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDirectConsumerAccount } from "@/lib/direct-consumer-accounts";
import { tryGetFixfyAccountId } from "@/lib/fixfy-account";
import { resolveJobCompletionInstant } from "@/lib/job-completion-anchor";

const STATUS_EM_ANDAMENTO = ["unassigned", "scheduled", "in_progress", "late", "on_hold", "final_check", "awaiting_payment", "need_attention"];
const JANELA_DIAS = 3;

/** O contato da /inbox (só dígitos, com 44) a partir do telefone do cadastro. */
export function contatoDoTelefone(telefone: string | null | undefined): string | null {
  let d = String(telefone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = `44${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("7")) d = `44${d}`;
  return d.length >= 11 ? d : null;
}

export type EstadoDaConversa = { resolvida_em: string | null; arquivada_em: string | null; excluida_em: string | null } | null;

/** A regra, sem banco: resolve ou diz por que não. */
export function decidirResolver(a: {
  b2c: boolean;
  outroJobAtivo: boolean;
  concluidoEm: Date | null;
  ultimaEntrada: string | null;
  conversa: EstadoDaConversa;
}): { resolver: true } | { resolver: false; motivo: string } {
  if (!a.b2c) return { resolver: false, motivo: "account job (B2B)" };
  if (a.outroJobAtivo) return { resolver: false, motivo: "client has another active job" };
  if (!a.concluidoEm) return { resolver: false, motivo: "no completion time" };
  const t = a.concluidoEm.getTime();
  if (a.ultimaEntrada && new Date(a.ultimaEntrada).getTime() > t) return { resolver: false, motivo: "client wrote after the job ended" };
  if (a.conversa?.arquivada_em || a.conversa?.excluida_em) return { resolver: false, motivo: "conversation archived or deleted" };
  if (a.conversa?.resolvida_em && new Date(a.conversa.resolvida_em).getTime() >= t) return { resolver: false, motivo: "already resolved" };
  return { resolver: true };
}

export type ResultadoResolverAoConcluir = { ensaio: boolean; olhados: number; resolvidas: string[]; pulados: string[] };

export async function resolverConversasDeJobsConcluidos(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoResolverAoConcluir> {
  const out: ResultadoResolverAoConcluir = { ensaio: !aplicar, olhados: 0, resolvidas: [], pulados: [] };
  const desde = new Date(agora.getTime() - JANELA_DIAS * 864e5).toISOString();
  const { data: jobs, error } = await sb
    .from("jobs")
    .select("id, reference, client_id, account_id, scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report, updated_at")
    .eq("status", "completed")
    .gte("updated_at", desde)
    .is("deleted_at", null)
    .limit(200);
  if (error) throw new Error(`completed jobs: ${error.message}`);
  const fixfy = await tryGetFixfyAccountId(sb);
  const vistos = new Set<string>();

  for (const j of (jobs ?? []) as Array<Record<string, unknown>>) {
    const ref = String(j.reference ?? j.id);
    const clientId = typeof j.client_id === "string" ? j.client_id : null;
    if (!clientId || vistos.has(clientId)) continue;
    vistos.add(clientId);
    out.olhados++;
    const conta = typeof j.account_id === "string" ? j.account_id : null;
    const b2c = !conta || conta === fixfy || isDirectConsumerAccount(conta);

    const { data: cliente } = await sb.from("clients").select("phone").eq("id", clientId).maybeSingle();
    const contato = contatoDoTelefone((cliente as { phone?: string | null } | null)?.phone);
    if (!contato) { out.pulados.push(`${ref}: no phone`); continue; }

    const { count: ativos } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("client_id", clientId).in("status", STATUS_EM_ANDAMENTO).is("deleted_at", null);
    const { data: entrada } = await sb.from("wa_mensagens").select("criado_em").eq("contato", contato).eq("direcao", "entrada").order("criado_em", { ascending: false }).limit(1).maybeSingle();
    const ultimaEntrada = (entrada as { criado_em?: string } | null)?.criado_em ?? null;
    if (!ultimaEntrada) { out.pulados.push(`${ref}: no conversation on the ops number`); continue; }
    const { data: conversa } = await sb.from("inbox_conversas").select("resolvida_em, arquivada_em, excluida_em").eq("contato", contato).maybeSingle();

    const d = decidirResolver({
      b2c,
      outroJobAtivo: (ativos ?? 0) > 0,
      concluidoEm: resolveJobCompletionInstant(j as never),
      ultimaEntrada,
      conversa: (conversa as EstadoDaConversa) ?? null,
    });
    if (!d.resolver) { out.pulados.push(`${ref}: ${d.motivo}`); continue; }
    if (aplicar) {
      const iso = agora.toISOString();
      const { error: e } = await sb.from("inbox_conversas").upsert({ contato, resolvida_em: iso, resolvida_por: null, atualizado_em: iso }, { onConflict: "contato" });
      if (e) { out.pulados.push(`${ref}: ${e.message}`); continue; }
    }
    out.resolvidas.push(`${ref} → …${contato.slice(-4)}`);
  }
  return out;
}
