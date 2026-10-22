/**
 * Aviso de reclamação ao cliente (dono, 22/10/2026).
 *
 * Quando o job entra em On Hold como reclamação (preset `complaint`, descrição da
 * reclamação ou "complaint" no motivo), o cliente recebe UM e-mail curto: recebemos,
 * sentimos muito, alguém da equipe fala com você em até 24 horas. Sai pelo ticket do
 * job (a resposta cai no mesmo lugar). Vale para o cliente da Fixfy e para a conta B2B;
 * cliente final de plataforma (Express, Housekeep, Fantastic) não recebe: quem fala com
 * ele é a plataforma.
 *
 * Uma vez por reclamação: a chave é o job + o momento em que entrou em On Hold.
 * Só reclamação aberta a partir de INICIO_DO_AVISO: nada retroativo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailFixfy, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { semTravessao } from "@/lib/emails/billing-email-common";
import { jobOnHoldPorReclamacao } from "@/lib/job-on-hold-reasons";
import { tipoDaConta } from "@/lib/processo/conta";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

export const INICIO_DO_AVISO = "2026-10-22T17:00:00Z";
/** Reclamação mais velha que isto já foi tratada por gente: não manda. */
const JANELA_HORAS = 48;

export type JobDaReclamacao = {
  id: string;
  reference: string;
  title?: string | null;
  property_address?: string | null;
  status?: string | null;
  on_hold_at?: string | null;
  on_hold_reason_preset_id?: string | null;
  on_hold_reason?: string | null;
  on_hold_complaint_description?: string | null;
  deleted_at?: string | null;
};

export function chaveDaReclamacao(jobId: string, onHoldAt: string): string {
  return chaveDeEnvio("reclamacao", jobId, onHoldAt);
}

/** Puro: este job pede o aviso agora? */
export function pedeAviso(j: JobDaReclamacao, tipoConta: string | null, agora: Date): { sim: true } | { sim: false; motivo: string } {
  if (j.deleted_at) return { sim: false, motivo: "job deleted" };
  if (j.status !== "on_hold") return { sim: false, motivo: "job not on hold" };
  if (!jobOnHoldPorReclamacao(j)) return { sim: false, motivo: "on hold for another reason" };
  if (!j.on_hold_at) return { sim: false, motivo: "no on hold time" };
  const t = Date.parse(j.on_hold_at);
  if (t < Date.parse(INICIO_DO_AVISO)) return { sim: false, motivo: "complaint opened before this notice existed" };
  if (agora.getTime() - t > JANELA_HORAS * 3_600_000) return { sim: false, motivo: "complaint older than 48 hours" };
  if (tipoConta === "platform") return { sim: false, motivo: "platform customer: the platform talks to them" };
  return { sim: true };
}

/** Puro: o e-mail. */
export function emailDaReclamacao(p: { publico: Publico; referencia: string; servico?: string | null; endereco?: string | null; zendesk?: boolean }): { assunto: string; html: string; text: string } {
  const servico = semTravessao(p.servico) || null;
  const endereco = semTravessao(p.endereco) || null;
  const { html, text } = emailFixfy({
    preheader: "We’ve logged it and someone from our team will contact you within 24 hours.",
    estado: { texto: "We’re on it", cor: "orange" },
    titulo: "We’re sorry, we’re on it",
    saudacao: saudacao(p.publico),
    paragrafos: [
      `Thank you for letting us know about the work${endereco ? ` at ${endereco}` : ""}. We’re sorry it wasn’t right.`,
      "We’ve logged it and a member of our team will contact you within 24 hours to agree the next step.",
      "If there’s anything else we should know, or photos that help explain it, just reply to this email.",
    ],
    linhas: [
      ["Service", servico],
      ["Property", endereco],
      ["Booking", p.referencia],
    ],
    zendesk: p.zendesk,
  });
  return { assunto: `We’re looking into it · ${p.referencia}`, html, text };
}

export type LinhaDaReclamacao = { reference: string; resultado: "enviado" | "pulado" | "falhou" | "ensaio"; detalhe: string };

/** Varre os jobs em On Hold e manda o aviso a quem ainda não recebeu. */
export async function varrerReclamacoes(
  sb: SupabaseClient,
  opcoes: { aplicar?: boolean; agora?: Date } = {},
): Promise<{ linhas: LinhaDaReclamacao[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const agora = opcoes.agora ?? new Date();
  const { mensagensAoClienteLigadas } = await import("@/lib/client-confirmation/policy");
  const podeMandar = opcoes.aplicar === true && mensagensAoClienteLigadas();
  const aviso = opcoes.aplicar && !podeMandar ? "CLIENT_MESSAGING_ENABLED is not 1: nothing sent" : null;
  const linhas: LinhaDaReclamacao[] = [];

  const desde = new Date(Math.max(Date.parse(INICIO_DO_AVISO), agora.getTime() - JANELA_HORAS * 3_600_000)).toISOString();
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, reference, title, property_address, status, on_hold_at, on_hold_reason_preset_id, on_hold_reason, on_hold_complaint_description, deleted_at, account_id, client_id, client_name, external_source, external_ref")
    .eq("status", "on_hold")
    .gte("on_hold_at", desde)
    .is("deleted_at", null)
    .limit(50);

  for (const j of (jobs ?? []) as Array<JobDaReclamacao & Record<string, unknown>>) {
    const { data: conta } = j.account_id
      ? await sb.from("accounts").select("id, process_type").eq("id", j.account_id as string).maybeSingle()
      : { data: null };
    const d = pedeAviso(j, tipoDaConta(conta as { id?: string | null; process_type?: string | null } | null), agora);
    if (!d.sim) continue;
    const chave = chaveDaReclamacao(j.id, j.on_hold_at!);
    const { data: ja } = await sb.from("outbound_messages").select("status").eq("dedupe_key", chave).maybeSingle();
    if ((ja as { status?: string } | null)?.status === "sent") continue;
    if (!podeMandar) { linhas.push({ reference: j.reference, resultado: "ensaio", detalhe: "would send the complaint notice" }); continue; }

    const { getZendeskTicketId } = await import("@/lib/zendesk");
    const ticketId = getZendeskTicketId(j as never);
    if (!ticketId) { linhas.push({ reference: j.reference, resultado: "pulado", detalhe: "job has no Zendesk ticket" }); continue; }
    const clientId = typeof j.client_id === "string" ? j.client_id : "";
    const { resolveNominalBillingParty } = await import("@/lib/account-billing-addressee");
    const { publicoDaCobranca } = await import("@/lib/emails/billing-email-common");
    const billing = await resolveNominalBillingParty(sb, { clientId, fallbackName: String(j.client_name ?? "") });

    const r = await reservarEnvio(sb, { chave, finalidade: "complaint_notice", canal: "email", jobId: j.id, ticketId: Number(ticketId) || null, destinatario: billing.documentEmail ?? null, motivo: "job on hold for a complaint" }, agora);
    if (!r.reservado) { linhas.push({ reference: j.reference, resultado: "pulado", detalhe: r.motivo ?? "not reserved" }); continue; }
    try {
      const e = emailDaReclamacao({
        publico: publicoDaCobranca(billing.mode, billing.displayName, billing.companyName),
        referencia: j.reference,
        servico: j.title ?? null,
        endereco: j.property_address ?? null,
        zendesk: true,
      });
      const { avisarNoTicketDoJob } = await import("@/lib/um-ticket/aviso-do-job");
      const entrega = await avisarNoTicketDoJob({ ticketId: Number(ticketId), para: { email: billing.documentEmail, nome: billing.displayName }, assunto: e.assunto, html: e.html });
      await confirmarEnvio(sb, chave);
      linhas.push({ reference: j.reference, resultado: "enviado", detalhe: `${entrega.modo} on #${ticketId}` });
    } catch (err) {
      await falhouEnvio(sb, chave, err).catch(() => undefined);
      linhas.push({ reference: j.reference, resultado: "falhou", detalhe: err instanceof Error ? err.message : String(err) });
    }
  }
  return { linhas, modo: podeMandar ? "envio" : "ensaio", aviso };
}
