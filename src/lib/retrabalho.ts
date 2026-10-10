/**
 * Reclamação vira retrabalho (Fase 4, dono 09/10/2026): quem executou volta para
 * consertar, sem cobrar o cliente e sem pagar o parceiro. O job nasce a £0 dos dois
 * lados, oferecido SÓ ao parceiro original (app, e-mail e side conversation no ticket
 * do job). Não aceitou em 24h, volta para a equipe realocar.
 *
 * Marca no `internal_notes`: `remedial-of:JOB-XXXX`, que também impede duplicar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";

export const PRAZO_DO_RETRABALHO_H = 24;
export const MARCA_RETRABALHO = "remedial-of:";

type Original = Pick<
  Job,
  "id" | "reference" | "title" | "client_id" | "client_name" | "property_address" | "partner_id" | "partner_name" | "catalog_service_id" | "scope" | "external_ref"
> & { property_id?: string | null; latitude?: number | null; longitude?: number | null };

/** A linha do job de retrabalho (sem banco: testável). */
export function linhaDoRetrabalho(original: Original, resumo: string, ticketDaReclamacao: number | null, agora = new Date()) {
  const temParceiro = Boolean(original.partner_id);
  return {
    title: `Remedial: ${original.title ?? original.reference}`.slice(0, 200),
    client_id: original.client_id ?? null,
    client_name: original.client_name,
    property_address: original.property_address,
    property_id: original.property_id ?? null,
    latitude: original.latitude ?? null,
    longitude: original.longitude ?? null,
    catalog_service_id: original.catalog_service_id ?? null,
    scope: [
      `Remedial visit for ${original.reference}: put right what the customer raised.`,
      `Complaint: ${resumo}`,
      "No charge to the customer and no pay for this visit: it fixes work already done.",
      original.scope ? `\nOriginal scope:\n${original.scope}` : "",
    ].filter(Boolean).join("\n"),
    job_type: "fixed" as const,
    job_kind: "one_off",
    client_price: 0,
    partner_cost: 0,
    extras_amount: 0,
    partner_id: null,
    status: temParceiro ? "auto_assigning" : "unassigned",
    auto_assign_invited_partner_ids: temParceiro ? [original.partner_id!] : [],
    auto_assign_expires_at: temParceiro ? new Date(agora.getTime() + PRAZO_DO_RETRABALHO_H * 3_600_000).toISOString() : null,
    internal_notes: `${MARCA_RETRABALHO}${original.reference}${ticketDaReclamacao ? ` · complaint ticket #${ticketDaReclamacao}` : ""}`,
  };
}

export type RetrabalhoCriado =
  | { ok: true; reference: string; jaExistia: boolean; oferecidoA: string | null }
  | { ok: false; erro: string };

export async function criarJobDeRetrabalho(
  sb: SupabaseClient,
  original: Original,
  resumo: string,
  ticketDaReclamacao: number | null,
): Promise<RetrabalhoCriado> {
  const { data: ja } = await sb
    .from("jobs")
    .select("reference")
    .ilike("internal_notes", `%${MARCA_RETRABALHO}${original.reference}%`)
    .not("status", "in", "(cancelled,deleted)")
    .is("deleted_at", null)
    .limit(1);
  if (ja?.length) return { ok: true, reference: String(ja[0].reference), jaExistia: true, oferecidoA: original.partner_name ?? null };

  const linha = linhaDoRetrabalho(original, resumo, ticketDaReclamacao);
  const { data: novo, error } = await sb.from("jobs").insert(linha).select("id, reference").single();
  if (error || !novo) return { ok: false, erro: error?.message ?? "insert failed" };

  if (original.partner_id) {
    try {
      const { dispatchAutoAssignJobInvites } = await import("@/lib/auto-assign-job-invites");
      await dispatchAutoAssignJobInvites({
        supabase: sb,
        jobId: String(novo.id),
        jobReference: String(novo.reference),
        jobTitle: linha.title,
        clientName: linha.client_name ?? "",
        propertyAddress: linha.property_address ?? "",
        scope: linha.scope,
        scheduledDate: null,
        partnerIds: [original.partner_id],
        zendeskTicketId: original.external_ref ?? null,
      });
    } catch (e) {
      console.error("[retrabalho] convite ao parceiro falhou:", e);
    }
  }
  return { ok: true, reference: String(novo.reference), jaExistia: false, oferecidoA: original.partner_name ?? null };
}

/** Retrabalho que o parceiro não aceitou no prazo volta para a equipe (sem convite ativo). */
export async function devolverRetrabalhoVencido(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()) {
  const { data } = await sb
    .from("jobs")
    .select("id, reference, internal_notes, auto_assign_expires_at")
    .eq("status", "auto_assigning")
    .ilike("internal_notes", `%${MARCA_RETRABALHO}%`)
    .lt("auto_assign_expires_at", agora.toISOString())
    .is("deleted_at", null);
  const vencidos = (data ?? []) as Array<{ id: string; reference: string; internal_notes: string | null }>;
  if (aplicar) {
    for (const j of vencidos) {
      await sb
        .from("jobs")
        .update({
          status: "unassigned",
          auto_assign_invited_partner_ids: [],
          auto_assign_expires_at: null,
          internal_notes: `${j.internal_notes ?? ""}\nPartner did not accept the remedial visit in ${PRAZO_DO_RETRABALHO_H}h: reassign.`.trim(),
        })
        .eq("id", j.id)
        .eq("status", "auto_assigning");
    }
  }
  return { ensaio: !aplicar, devolvidos: vencidos.map((j) => j.reference) };
}
