/**
 * HARVEY — vigia de cancelamentos (dono, 19/08/2026):
 *
 *   "chegou um email do checkatrade express pra cancelar um job, já estava em
 *    auto solved... se ngm vê passa batido. alocar nas skills dele: ver esse
 *    tipo de email de qualquer cliente, check no OS, se tiver lá já cancelar
 *    e ter certeza que o email de cancelamento foi enviado ao partner."
 *
 * Todo ciclo o Harvey varre tickets recentes (INCLUINDO solved — é aí que o
 * cancelamento morre sem ninguém ver) atrás de aviso de cancelamento de
 * qualquer plataforma B2B. Cancelar job é DESTRUTIVO, então a trava é dupla:
 * só age com match inequívoco (link da plataforma → marcador checkatrade-lead
 * no job, ou postcode+data com UM único job vivo); qualquer dúvida REABRE o
 * ticket pra cair no Action Required com nota ⚠️ — o oposto de passar batido.
 *
 * Quando age, usa o MESMO fluxo do escritório: economia zerada + snapshot de
 * receita perdida + fila de auto-assign limpa + timers, e o e-mail ao parceiro
 * sai pela mesma engine dos cancelamentos manuais (side conversation no
 * Zendesk). Tudo vira nota interna no ticket — o rastro é público pro time.
 */
import type { Job } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import {
  patchOfficeCancelLostSnapshot,
  patchOfficeCancelZeroJobEconomics,
} from "@/lib/job-cancel-economics";
import { clearAutoAssignQueuePatch } from "@/lib/job-partner-assign";
import { cancelOpenVisitsForJobCancellation } from "@/services/job-visits";
import { runOfficeCancelAutoAssignCleanup } from "@/lib/office-cancel-auto-assign-cleanup";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { postarNotaInterna } from "./quoter";

const TAG_VIGIA = "ai_cancel_watch";
const MAX_POR_CICLO = 3;

function baseUrl(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}
function authHeader(): string {
  const raw = `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

type TicketCancelamento = { id: number; subject: string; status: string; tags: string[] };

/** Tickets recentes com cara de cancelamento — solved INCLUÍDO de propósito.
 *  Três buscas porque o full-text do Zendesk NÃO faz stemming: "cancel",
 *  "cancelled" e "cancellation" são palavras diferentes pra ele (visto na
 *  prática: "cancel" devolvia 0 com 4 avisos "cancelled" na janela). */
async function buscarSuspeitos(): Promise<TicketCancelamento[]> {
  const desde = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const porId = new Map<number, TicketCancelamento>();
  for (const termo of ["cancel", "cancelled", "cancellation"]) {
    const query = `type:ticket updated>${desde} ${termo} -tags:${TAG_VIGIA}`;
    const res = await fetch(
      `${baseUrl()}/search.json?query=${encodeURIComponent(query)}&sort_by=updated_at&sort_order=desc&per_page=40`,
      { headers: { Authorization: authHeader() } },
    );
    if (!res.ok) { console.error(`[harvey] search cancelamentos "${termo}": HTTP ${res.status}`); continue; }
    const json = (await res.json()) as { results?: TicketCancelamento[] };
    for (const t of json.results ?? []) porId.set(t.id, t);
  }
  // O full-text acha a palavra em qualquer lugar; o assunto decide o que é
  // aviso de verdade ("Job cancelled", "Cancellation request", ...).
  return [...porId.values()].filter(
    (t) => /cancel/i.test(t.subject) && !/^\s*JOB-/i.test(t.subject),
  );
}

async function lerComentarios(ticketId: number): Promise<{ texto: string; html: string }> {
  const res = await fetch(`${baseUrl()}/tickets/${ticketId}/comments.json?per_page=4`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) return { texto: "", html: "" };
  const json = (await res.json()) as { comments?: Array<{ body: string; html_body?: string }> };
  const cs = json.comments ?? [];
  return {
    texto: cs.map((c) => c.body).join("\n\n").slice(0, 4000),
    html: cs.map((c) => c.html_body ?? "").join("\n"),
  };
}

type Aviso = {
  isCancelamento: boolean;
  postcode: string | null;
  clientName: string | null;
  date: string | null;
  service: string | null;
};

async function classificarAviso(subject: string, texto: string, apiKey: string): Promise<Aviso> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You read a helpdesk ticket and decide if it is a notice that a BOOKED JOB WAS/MUST BE CANCELLED (platform cancellation email, or the client asking to cancel a scheduled visit). A quote rejection, an unsubscribe, or the word "cancel" in passing are NOT it. Strict JSON: {"is_cancellation":bool,"postcode":str|null,"client_name":str|null,"date":"YYYY-MM-DD"|null,"service":str|null}. Only values written in the text; never guess.',
        },
        { role: "user", content: `Subject: ${subject}\n\n${texto}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI cancelamento: HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  return {
    isCancelamento: j.is_cancellation === true,
    postcode: (j.postcode as string) || null,
    clientName: (j.client_name as string) || null,
    date: (j.date as string) || null,
    service: (j.service as string) || null,
  };
}

/**
 * Acha O job — e só age se for exatamente um. Ordem de confiança:
 * 1. Link business-jobs/<id> no e-mail → marcador `checkatrade-lead:<id>`.
 * 2. Postcode com UM único job vivo.
 * 3. Nome do cliente com UM único job vivo.
 */
async function acharJobDoAviso(aviso: Aviso, html: string): Promise<{ job: Job | null; como: string }> {
  const supabase = createServiceClient();
  const vivos = supabase
    .from("jobs")
    .select("*")
    .not("status", "in", "(cancelled,completed,deleted)")
    .is("deleted_at", null);

  const link = html.match(/business-jobs\/([a-z0-9]{10,})/i)?.[1];
  if (link) {
    // Import manual guarda o id no marcador checkatrade-lead; job do RPA
    // guarda no report_link (business-jobs/<id>). Os dois contam.
    const { data } = await createServiceClient()
      .from("jobs")
      .select("*")
      .or(`internal_notes.ilike.%checkatrade-lead:${link}%,report_link.ilike.%business-jobs/${link}%`)
      .is("deleted_at", null);
    if (data?.length === 1) return { job: data[0] as Job, como: `platform link (${link})` };
  }
  if (aviso.postcode) {
    const pc = aviso.postcode.replace(/\s+/g, "").toUpperCase();
    const { data } = await vivos;
    const hits = ((data ?? []) as Job[]).filter(
      (jb) => `${jb.property_address ?? ""}`.replace(/\s+/g, "").toUpperCase().includes(pc),
    );
    if (hits.length === 1) return { job: hits[0]!, como: `postcode ${aviso.postcode} (single live job)` };
    if (hits.length > 1 && aviso.date) {
      const doDia = hits.filter((jb) => jb.scheduled_date === aviso.date);
      if (doDia.length === 1) return { job: doDia[0]!, como: `postcode + date ${aviso.date}` };
    }
  }
  if (aviso.clientName) {
    const { data } = await createServiceClient()
      .from("jobs")
      .select("*")
      .ilike("client_name", `%${aviso.clientName}%`)
      .not("status", "in", "(cancelled,completed,deleted)")
      .is("deleted_at", null);
    if (data?.length === 1) return { job: data[0] as Job, como: `client name "${aviso.clientName}" (single live job)` };
  }
  return { job: null, como: "no unambiguous match" };
}

/** Aviso que casa com job JÁ cancelado (últimos 7 dias) = duplicata. */
async function acharJaCancelado(aviso: Aviso, html: string): Promise<Job | null> {
  const supabase = createServiceClient();
  const corte = new Date(Date.now() - 7 * 864e5).toISOString();
  const link = html.match(/business-jobs\/([a-z0-9]{10,})/i)?.[1];
  if (link) {
    const { data } = await supabase
      .from("jobs").select("*").eq("status", "cancelled").gte("cancelled_at", corte)
      .or(`internal_notes.ilike.%checkatrade-lead:${link}%,report_link.ilike.%business-jobs/${link}%`);
    if (data?.length === 1) return data[0] as Job;
  }
  if (aviso.postcode) {
    const pc = aviso.postcode.replace(/\s+/g, "").toUpperCase();
    const { data } = await supabase
      .from("jobs").select("*").eq("status", "cancelled").gte("cancelled_at", corte);
    const hits = ((data ?? []) as Job[]).filter(
      (jb) => `${jb.property_address ?? ""}`.replace(/\s+/g, "").toUpperCase().includes(pc),
    );
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** O MESMO cancelamento do escritório, sem fees (decisão de fee é humana). */
async function cancelarNoOs(job: Job, ticketId: number): Promise<void> {
  const supabase = createServiceClient();
  const motivo = `Client requested cancellation — platform cancellation email (ticket #${ticketId}).`;
  const patch: Partial<Job> = {
    ...patchOfficeCancelZeroJobEconomics(),
    ...patchOfficeCancelLostSnapshot(job),
    ...clearAutoAssignQueuePatch(),
    status: "cancelled",
    cancellation_reason: motivo,
    cancellation_reason_preset_id: "client_requested",
    cancellation_fault: null,
    cancelled_at: new Date().toISOString(),
    cancelled_by: null,
    ...statusChangePartnerTimerPatch(job, "cancelled"),
    ...statusChangeOfficeTimerPatch(job, "cancelled"),
  };
  const { error } = await supabase.from("jobs").update(patch).eq("id", job.id);
  if (error) throw new Error(`cancel ${job.reference}: ${error.message}`);

  await cancelOpenVisitsForJobCancellation(job.id, supabase).catch(() => {});
  // Convites pendentes viram "lost" e as side conversations de oferta fecham,
  // igual ao cancel do escritório — sem isso a oferta segue viva no portal.
  await runOfficeCancelAutoAssignCleanup(supabase, job.id).catch(() => {});

  // Ticket do job espelha o status na hora (Cancelled + tags coerentes).
  await syncJobZendeskStatus(job.id).catch(() => {});
}

async function adicionarTag(ticketId: number): Promise<void> {
  await fetch(`${baseUrl()}/tickets/${ticketId}/tags.json`, {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ tags: [TAG_VIGIA] }),
  }).catch(() => {});
}

async function reabrirTicket(ticketId: number): Promise<void> {
  await fetch(`${baseUrl()}/tickets/${ticketId}.json`, {
    method: "PUT",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ ticket: { status: "open" } }),
  }).catch(() => {});
}

export type ResultadoVigia = { analisados: number; cancelados: number; reabertos: number };

export async function vigiarCancelamentos(vistos: Set<number>): Promise<ResultadoVigia> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const suspeitos = (await buscarSuspeitos()).filter((t) => !vistos.has(t.id));
  const r: ResultadoVigia = { analisados: 0, cancelados: 0, reabertos: 0 };

  for (const t of suspeitos.slice(0, MAX_POR_CICLO)) {
    r.analisados++;
    vistos.add(t.id);
    try {
      const { texto, html } = await lerComentarios(t.id);
      const aviso = await classificarAviso(t.subject, texto, apiKey);
      if (!aviso.isCancelamento) {
        await adicionarTag(t.id);
        continue;
      }

      const { job, como } = await acharJobDoAviso(aviso, html);

      if (!job) {
        // Plataforma manda o MESMO cancelamento em dois e-mails: se um job
        // recém-cancelado casa com o aviso, isto é duplicata — nota e pronto,
        // sem reabrir ticket pro humano à toa.
        const dup = await acharJaCancelado(aviso, html);
        if (dup) {
          await postarNotaInterna(t.id, `✅ HARVEY — duplicate cancellation notice: ${dup.reference} is already cancelled in the OS. Nothing to do.`);
          await adicionarTag(t.id);
          continue;
        }
      }

      if (!job) {
        // Sem certeza NÃO se cancela nada — mas também não passa batido:
        // reabre pro Action Required com a nota do que faltou.
        await reabrirTicket(t.id);
        await postarNotaInterna(
          t.id,
          [
            "⚠️ HARVEY — cancellation notice detected, but I could NOT match it to exactly one live job in the OS.",
            "",
            `What I read: ${aviso.service ?? t.subject}${aviso.postcode ? ` · ${aviso.postcode}` : ""}${aviso.date ? ` · ${aviso.date}` : ""}${aviso.clientName ? ` · ${aviso.clientName}` : ""}`,
            `Match attempt: ${como}.`,
            "",
            "Reopened this ticket so it lands in Action Required — please cancel the right job manually.",
          ].join("\n"),
        );
        await adicionarTag(t.id);
        r.reabertos++;
        console.log(`[harvey] cancelamento #${t.id}: sem match — reaberto pro humano`);
        continue;
      }

      if (job.status === "cancelled") {
        await postarNotaInterna(t.id, `✅ HARVEY — cancellation notice checked: ${job.reference} is already cancelled in the OS. Nothing to do.`);
        await adicionarTag(t.id);
        continue;
      }

      const tinhaParceiro = Boolean(job.partner_id);
      await cancelarNoOs(job, t.id);

      // O e-mail ao parceiro sai pela MESMA engine do cancelamento manual.
      let parceiroInfo = "no partner was assigned — nothing to send.";
      if (tinhaParceiro) {
        const res = await notifyPartnerJobZendesk(createServiceClient(), job.id, {
          kind: "cancelled",
          reason: `The client cancelled this visit (platform notice, ticket #${t.id}).`,
          newStatusLabel: "Cancelled",
        }).catch((err) => ({ ok: false, error: String(err) }) as const);
        parceiroInfo =
          "ok" in res && res.ok
            ? "partner notified by email (side conversation on the job ticket)."
            : `partner notification FAILED — send it manually. (${"error" in res ? res.error : "unknown"})`;
      }

      await postarNotaInterna(
        t.id,
        [
          `✅ HARVEY — ${job.reference} cancelled in the OS from this notice.`,
          "",
          `Job: ${job.title} · ${job.client_name} · ${job.property_address}`,
          `Matched by: ${como}.`,
          `Partner: ${parceiroInfo}`,
          "",
          "Cancellation reason recorded as: client requested (platform email). Fees, if any, are a human call — none were applied.",
        ].join("\n"),
      );
      if (job.external_source === "zendesk" && job.external_ref && String(t.id) !== String(job.external_ref)) {
        await postarNotaInterna(
          Number(job.external_ref),
          `⚠️ HARVEY — this job was cancelled: the client sent a cancellation notice (ticket #${t.id}). ${tinhaParceiro ? "Partner was notified by email." : "No partner was assigned."}`,
        ).catch(() => {});
      }
      await adicionarTag(t.id);
      r.cancelados++;
      console.log(`[harvey] cancelamento #${t.id}: ${job.reference} cancelado (${como})`);
    } catch (err) {
      console.error(`[harvey] vigia de cancelamento falhou no #${t.id}: ${err}`);
    }
  }
  return r;
}
