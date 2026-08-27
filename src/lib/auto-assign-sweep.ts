/**
 * O vigia de ofertas (Fase 3 do auto-flow): mantém a vitrine viva sem poluir
 * caixa de entrada nenhuma.
 *
 * Para cada job em auto_assigning sem parceiro:
 *   1. Re-checa o portão (completude + piso de margem): job que foi editado
 *      até ficar inválido volta para unassigned (Needs Review).
 *   2. Expira convites vencidos (`job_partner_invites.status = 'expired'`
 *      deixa de ser código morto) e renova a janela da oferta.
 *   3. Refaz o matching e convida SÓ quem nunca recebeu o Job Offer daquele
 *      job (parceiro ativado depois do primeiro disparo entra; quem já
 *      recebeu não recebe de novo — regra de email do projeto).
 *   4. Encalhe: 24h sem aceite → reabre o ticket do job com nota interna
 *      (cai no Action Required), uma vez só (tag `ai_offer_stale`).
 *
 * Nasce em MODO ENSAIO (lição de 20/08: rotina solta em produção sem ensaio
 * soltou um parceiro de 15 jobs). Só age com HARVEY_OFERTAS_ARMADO=1; sem a
 * variável, loga o que FARIA e não escreve nada. Teto de jobs por ciclo.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { dispatchAutoAssignJobInvites } from "@/lib/auto-assign-job-invites";
import { autoAssignGate, autoAssignGateBlockText } from "@/lib/auto-assign-gate";
import { autoAssignExpiresAtIso } from "@/lib/auto-assign-offer";
import { resolveJobMatchServiceType } from "@/lib/zendesk-job-ingest";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { updateTicket, addTicketTags } from "@/lib/zendesk";

const TETO_JOBS_POR_CICLO = 10;
const ENCALHE_HORAS = 24;
const TAG_ENCALHE = "ai_offer_stale";

type JobDaVitrine = {
  id: string;
  reference: string;
  title: string | null;
  client_name: string | null;
  property_address: string | null;
  scope: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  catalog_service_id: string | null;
  external_source: string | null;
  external_ref: string | null;
  auto_assign_invited_partner_ids: string[] | null;
  auto_assign_expires_at: string | null;
  created_at: string | null;
  latitude: number | null;
  longitude: number | null;
  job_type: string | null;
  client_price: number | null;
  partner_cost: number | null;
  hourly_client_rate: number | null;
  hourly_partner_rate: number | null;
};

type InviteRow = { partner_id: string; status: string; invited_at: string | null };

export type ResultadoVarredura = {
  analisados: number;
  bloqueadosPeloPortao: number;
  convitesExpirados: number;
  novosConvidados: number;
  encalhados: number;
  armado: boolean;
};

function armado(): boolean {
  return process.env.HARVEY_OFERTAS_ARMADO === "1";
}

async function reabrirTicketComNota(ticketId: string, nota: string): Promise<void> {
  await updateTicket({ ticketId, commentBody: nota, publicComment: false });
  const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
  const auth = `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64")}`;
  await fetch(`${base}/tickets/${ticketId}.json`, {
    method: "PUT",
    headers: { Authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ ticket: { status: "open" } }),
  });
  await addTicketTags(ticketId, [TAG_ENCALHE]);
}

export async function varrerOfertas(): Promise<ResultadoVarredura> {
  const supabase = createServiceClient();
  const agir = armado();
  const agora = Date.now();
  const r: ResultadoVarredura = {
    analisados: 0,
    bloqueadosPeloPortao: 0,
    convitesExpirados: 0,
    novosConvidados: 0,
    encalhados: 0,
    armado: agir,
  };

  const { data } = await supabase
    .from("jobs")
    .select(
      "id, reference, title, client_name, property_address, scope, scheduled_date, scheduled_start_at, scheduled_end_at, catalog_service_id, external_source, external_ref, auto_assign_invited_partner_ids, auto_assign_expires_at, created_at, latitude, longitude, job_type, client_price, partner_cost, hourly_client_rate, hourly_partner_rate",
    )
    .eq("status", "auto_assigning")
    .is("partner_id", null)
    .is("deleted_at", null)
    .limit(TETO_JOBS_POR_CICLO);

  const jobs = (data ?? []) as JobDaVitrine[];
  const modo = agir ? "ARMADO" : "ensaio";

  for (const job of jobs) {
    r.analisados++;

    // 1. Portão: job editado até ficar inválido sai da vitrine.
    const { serviceType, catalogServiceId } = await resolveJobMatchServiceType(supabase, job);
    const gate = autoAssignGate({
      serviceType: serviceType || job.title,
      propertyAddress: job.property_address,
      scope: job.scope,
      scheduledStartAt: job.scheduled_start_at,
      scheduledEndAt: job.scheduled_end_at,
      jobType: job.job_type,
      clientPrice: job.client_price,
      partnerCost: job.partner_cost,
      hourlyClientRate: job.hourly_client_rate,
      hourlyPartnerRate: job.hourly_partner_rate,
    });
    if (!gate.ok) {
      r.bloqueadosPeloPortao++;
      console.log(`[ofertas ${modo}] ${job.reference}: ${autoAssignGateBlockText(gate)}`);
      if (agir) {
        await supabase.from("jobs").update({ status: "unassigned" }).eq("id", job.id);
      }
      continue;
    }

    const { data: inviteData } = await supabase
      .from("job_partner_invites")
      .select("partner_id, status, invited_at")
      .eq("job_id", job.id);
    const invites = (inviteData ?? []) as InviteRow[];
    const jaConvidados = new Set(invites.map((i) => i.partner_id));
    const recusaram = new Set(
      invites.filter((i) => i.status === "declined" || i.status === "lost").map((i) => i.partner_id),
    );

    // 2. Convites vencidos viram 'expired' e a janela renova. O job continua
    //    na vitrine — expirar convite não apaga a oferta, só o countdown.
    const vencido = job.auto_assign_expires_at && Date.parse(job.auto_assign_expires_at) < agora;
    if (vencido) {
      const abertos = invites.filter((i) => i.status === "invited").length;
      r.convitesExpirados += abertos;
      console.log(`[ofertas ${modo}] ${job.reference}: janela vencida, ${abertos} convite(s) → expired`);
      if (agir) {
        await supabase
          .from("job_partner_invites")
          .update({ status: "expired", decided_at: new Date().toISOString() })
          .eq("job_id", job.id)
          .eq("status", "invited");
        await supabase
          .from("jobs")
          .update({ auto_assign_expires_at: autoAssignExpiresAtIso() })
          .eq("id", job.id);
      }
    }

    // 3. Re-match: novos parceiros (ativados depois do disparo) entram; quem
    //    já recebeu o Job Offer nunca recebe email de novo.
    const matched = await matchPartnerIdsForWork(supabase, {
      serviceType,
      catalogServiceId,
      postcode: extractUkPostcode(job.property_address ?? ""),
      latitude: job.latitude,
      longitude: job.longitude,
      kind: "job",
      availabilitySlot: {
        scheduledDate: job.scheduled_date,
        startAt: job.scheduled_start_at,
        endAt: job.scheduled_end_at,
      },
    });
    const desejados = matched.filter((id) => !recusaram.has(id));
    const novos = desejados.filter((id) => !jaConvidados.has(id));
    if (novos.length > 0) {
      r.novosConvidados += novos.length;
      console.log(`[ofertas ${modo}] ${job.reference}: ${novos.length} parceiro(s) novo(s) para convidar`);
    }
    if (agir) {
      const atual = new Set((job.auto_assign_invited_partner_ids ?? []).filter(Boolean));
      const fila = [...new Set([...atual, ...desejados])].filter((id) => !recusaram.has(id));
      await supabase
        .from("jobs")
        .update({ auto_assign_invited_partner_ids: fila })
        .eq("id", job.id);
      if (novos.length > 0) {
        await dispatchAutoAssignJobInvites({
          supabase,
          jobId: job.id,
          jobReference: job.reference,
          jobTitle: job.title || "Maintenance job",
          clientName: job.client_name || "—",
          propertyAddress: job.property_address || "—",
          scope: job.scope || "(no scope provided)",
          scheduledDate: job.scheduled_date,
          partnerIds: novos,
          zendeskTicketId: job.external_source === "zendesk" ? job.external_ref : null,
        }).catch((e) => console.error(`[ofertas] dispatch novos falhou ${job.reference}:`, e));
      }
    }

    // 4. Encalhe: 24h sem aceite vira decisão humana (Action Required).
    const inicioMs = Math.min(
      ...invites.map((i) => (i.invited_at ? Date.parse(i.invited_at) : Infinity)),
      job.created_at ? Date.parse(job.created_at) : Infinity,
    );
    const horasParado = Number.isFinite(inicioMs) ? (agora - inicioMs) / 3_600_000 : 0;
    if (horasParado >= ENCALHE_HORAS && job.external_source === "zendesk" && job.external_ref?.trim()) {
      r.encalhados++;
      console.log(`[ofertas ${modo}] ${job.reference}: ${Math.floor(horasParado)}h sem aceite — encalhe`);
      if (agir) {
        try {
          const tk = job.external_ref.trim();
          const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
          const auth = `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64")}`;
          const tRes = await fetch(`${base}/tickets/${tk}.json`, { headers: { Authorization: auth } });
          const tJson = (await tRes.json().catch(() => null)) as { ticket?: { tags?: string[] } } | null;
          if (!tJson?.ticket?.tags?.includes(TAG_ENCALHE)) {
            await reabrirTicketComNota(
              tk,
              `⚠️ HARVEY · ${job.reference} is ${Math.floor(horasParado)}h in auto assign with no acceptance. ` +
                `Decide: improve the partner pay, assign by hand, or cancel.`,
            );
          }
        } catch (e) {
          console.error(`[ofertas] encalhe falhou ${job.reference}:`, e);
        }
      }
    }
  }

  return r;
}
