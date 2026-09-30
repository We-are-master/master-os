/**
 * Reserva do Harvey por transferência bancária (29/09/2026): os jobs nascem no
 * OS aguardando o sinal de 50%, sem oferta a parceiro. Esta varredura roda no
 * ciclo da rota /api/cron/harvey-wa (n8n, 10 min) e cuida do resto:
 *
 *   sinal registrado em job_payments → confirma no WhatsApp, lead vira won e,
 *                                      com AUTO_ASSIGN_ALL_JOBS=1, a oferta sai
 *   18h sem sinal                    → lembra uma vez
 *   23h30 sem sinal                  → libera a vaga (cancela os jobs) e avisa
 *
 * A liberação sai antes de 24h porque o WhatsApp só deixa mandar texto livre
 * até 24h depois da última mensagem do cliente.
 *
 * Roda pela rota /api/cron/harvey-wa. Só age com HARVEY_WA_LIGADO=1; sem ela, só conta o que faria.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { cancelJobFromZendeskWebhook } from "@/lib/office-job-cancel-from-zendesk";
import { ensureAndDispatchAutoAssignInvites } from "@/lib/auto-assign-job-invites";
import { autoAssignExpiresAtIso } from "@/lib/auto-assign-offer";
import { registrarPagamento } from "@/lib/site-leads/core";
import { mandarEventoWhatsApp } from "@/lib/meta/eventos-whatsapp";
import { enviarTexto } from "./sunshine";

const LEMBRAR_EM_H = 18;
const LIBERAR_EM_H = 23.5;

type Pendente = {
  conversation_id: string;
  phone: string | null;
  email: string | null;
  checkout_ref: string | null;
  checkout_total: number | null;
  checkout_sinal: number | null;
  checkout_at: string;
  job_ids: string[];
  lembrado_em: string | null;
};

export type ResultadoTransferencias = { armado: boolean; pendentes: number; recebidos: number; lembrados: number; liberados: number; detalhes: string[] };

const gbp = (n: number | null) => `£${Number(n ?? 0).toFixed(2).replace(/\.00$/, "")}`;

export async function varrerTransferencias(
  sb: SupabaseClient = createServiceClient(),
  agora = new Date(),
  { aplicar = true }: { aplicar?: boolean } = {},
): Promise<ResultadoTransferencias> {
  const armado = aplicar && process.env.HARVEY_WA_LIGADO === "1";
  const out: ResultadoTransferencias = { armado, pendentes: 0, recebidos: 0, lembrados: 0, liberados: 0, detalhes: [] };
  const { data, error } = await sb
    .from("harvey_wa_conversas")
    .select("conversation_id, phone, email, checkout_ref, checkout_total, checkout_sinal, checkout_at, job_ids, lembrado_em")
    .eq("checkout_method", "bank")
    .is("sinal_recebido_em", null)
    .is("liberado_em", null)
    .not("checkout_at", "is", null)
    .limit(50);
  if (error) throw new Error(`transferências: ${error.message}`);
  const pendentes = (data ?? []) as Pendente[];
  out.pendentes = pendentes.length;

  for (const p of pendentes) {
    const ref = p.checkout_ref ?? "";
    if (!p.job_ids?.length) {
      out.detalhes.push(`${ref}: sem job no OS, nada a vigiar`);
      continue;
    }
    const horas = (agora.getTime() - new Date(p.checkout_at).getTime()) / 3_600_000;

    // 1) O sinal entrou? A equipe registra o depósito no Financeiro (job_payments).
    const { data: pagos } = await sb.from("job_payments").select("amount").in("job_id", p.job_ids).in("type", ["customer_deposit", "customer_final"]);
    const recebido = (pagos ?? []).reduce((s, x) => s + Number(x.amount ?? 0), 0);
    if (recebido > 0) {
      out.recebidos++;
      out.detalhes.push(`${ref}: sinal ${gbp(recebido)} recebido`);
      if (!armado) continue;
      await sb.from("harvey_wa_conversas").update({ sinal_recebido_em: agora.toISOString(), atualizado_em: agora.toISOString() }).eq("conversation_id", p.conversation_id);
      const resto = Math.max(0, Number(p.checkout_total ?? 0) - recebido);
      await enviarTexto(
        p.conversation_id,
        `Your deposit has landed, thank you. You're booked in (${ref})${resto > 0 ? `, and the other ${gbp(resto)} is paid after the job` : ""}. I'll be in touch with the details before the day.`,
      ).catch((e) => console.error("[harvey-wa] transferência: aviso de sinal", ref, e));
      if (p.email) await registrarPagamento({ email: p.email, jobId: p.job_ids[0], bookingRef: ref, total: Number(p.checkout_total ?? 0), promoCode: null }).catch(() => {});
      await mandarEventoWhatsApp(sb, { telefone: p.phone, evento: "Purchase", chave: ref, valor: p.checkout_total, agora }).catch((e) => console.error("[harvey-wa] meta compra", ref, e));
      if (process.env.AUTO_ASSIGN_ALL_JOBS === "1") {
        for (const id of p.job_ids) await despachar(sb, id).catch((e) => console.error("[harvey-wa] transferência: despacho", id, e));
      }
      continue;
    }

    // 2) Passou do prazo: libera a vaga.
    if (horas >= LIBERAR_EM_H) {
      out.liberados++;
      out.detalhes.push(`${ref}: ${horas.toFixed(1)}h sem sinal, libera a vaga`);
      if (!armado) continue;
      await sb.from("harvey_wa_conversas").update({ liberado_em: agora.toISOString(), atualizado_em: agora.toISOString() }).eq("conversation_id", p.conversation_id);
      await liberarJobs(sb, p.job_ids, ref);
      await enviarTexto(
        p.conversation_id,
        `I haven't seen the deposit for ${ref} come in, so I've had to let that slot go. If you still want it, just message me and I'll find you the next free day.`,
      ).catch((e) => console.error("[harvey-wa] transferência: aviso de liberação", ref, e));
      continue;
    }

    // 3) Lembra uma vez.
    if (horas >= LEMBRAR_EM_H && !p.lembrado_em) {
      out.lembrados++;
      out.detalhes.push(`${ref}: ${horas.toFixed(1)}h sem sinal, lembrete`);
      if (!armado) continue;
      await sb.from("harvey_wa_conversas").update({ lembrado_em: agora.toISOString(), atualizado_em: agora.toISOString() }).eq("conversation_id", p.conversation_id);
      await enviarTexto(
        p.conversation_id,
        `Quick one: I'm still holding your slot, but I haven't seen the ${gbp(p.checkout_sinal)} deposit for ${ref} yet. I can keep it until tomorrow morning. If a card link is easier, just say and I'll send one.`,
      ).catch((e) => console.error("[harvey-wa] transferência: lembrete", ref, e));
    }
  }
  return out;
}

/** O sinal entrou: o job sai de "aguardando depósito" para a oferta aos parceiros. */
async function despachar(sb: SupabaseClient, jobId: string) {
  const { data: job } = await sb.from("jobs").select("status, partner_id").eq("id", jobId).maybeSingle();
  if (!job || job.partner_id || job.status !== "unassigned") return;
  await sb.from("jobs").update({ status: "auto_assigning", auto_assign_expires_at: autoAssignExpiresAtIso() }).eq("id", jobId);
  const r = await ensureAndDispatchAutoAssignInvites(sb, jobId);
  if (!r.ok) console.warn("[harvey-wa] transferência: oferta não saiu", jobId, r.error);
}

/** Sem sinal no prazo: cancela os jobs pelo mesmo caminho do cancelamento no Zendesk. */
async function liberarJobs(sb: SupabaseClient, jobIds: string[], ref: string) {
  const { data: jobs } = await sb.from("jobs").select("id, reference, status, external_source, external_ref").in("id", jobIds);
  const tickets = new Set<string>();
  for (const j of jobs ?? []) {
    if (j.status === "cancelled" || j.status === "deleted") continue;
    if (j.external_source !== "zendesk" || !j.external_ref) {
      console.warn("[harvey-wa] transferência: job sem ticket, cancelar à mão", j.reference);
      continue;
    }
    if (tickets.has(j.external_ref)) continue;
    tickets.add(j.external_ref);
    const r = await cancelJobFromZendeskWebhook(
      {
        ticketId: j.external_ref,
        cancellationReasonId: "other",
        cancellationNotes: `Bank transfer deposit for ${ref} not received within 24 hours: slot released by Harvey.`,
        lostValueGbp: 0,
        cancelledByAgent: "Harvey",
      },
      sb,
    );
    if (!r.ok) console.warn("[harvey-wa] transferência: cancelamento falhou, cancelar à mão", j.reference, r.error);
  }
}
