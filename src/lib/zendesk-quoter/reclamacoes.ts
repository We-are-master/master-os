/**
 * Reclamação detectada vira ação — com a MESMA regra do vigia de
 * cancelamentos: só age com match inequívoco de job; qualquer dúvida vira
 * nota interna para o humano (a macro de complaint continua existindo).
 *
 * Quando o job é achado, o hold sai pela engine oficial
 * (`putJobOnHoldFromZendesk`): job pausa com preset `complaint`, parceiro é
 * avisado, feedback entra no ledger, invoices seguram e o ticket do job
 * sincroniza. Este módulo não reimplementa nada disso — só acha o job.
 */
import type { Job } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { putJobOnHoldFromZendesk } from "@/lib/job-on-hold-from-zendesk";

function baseUrl(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}
function authHeader(): string {
  const raw = `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
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

type Reclamacao = {
  isReclamacao: boolean;
  resumo: string | null;
  postcode: string | null;
  clientName: string | null;
  date: string | null;
};

async function classificarReclamacao(subject: string, texto: string, apiKey: string): Promise<Reclamacao> {
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
            'You read a helpdesk ticket and decide if it is a COMPLAINT about a job we booked or carried out (bad workmanship, damage, no-show, unfinished work, unhappy customer). A quote rejection, a price question or generic feedback are NOT it. Strict JSON: {"is_complaint":bool,"summary":str|null,"postcode":str|null,"client_name":str|null,"date":"YYYY-MM-DD"|null}. summary = one factual sentence of what they complain about. Only values written in the text; never guess.',
        },
        { role: "user", content: `Subject: ${subject}\n\n${texto}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI reclamacao: HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  return {
    isReclamacao: j.is_complaint === true,
    resumo: (j.summary as string) || null,
    postcode: (j.postcode as string) || null,
    clientName: (j.client_name as string) || null,
    date: (j.date as string) || null,
  };
}

/** A MESMA ordem de confiança do vigia de cancelamentos: link > postcode > nome. */
async function acharJobDaReclamacao(r: Reclamacao, html: string): Promise<{ job: Job | null; como: string }> {
  const supabase = createServiceClient();

  const link = html.match(/business-jobs\/([a-z0-9]{10,})/i)?.[1];
  if (link) {
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .or(`internal_notes.ilike.%checkatrade-lead:${link}%,report_link.ilike.%business-jobs/${link}%`)
      .is("deleted_at", null);
    if (data?.length === 1) return { job: data[0] as Job, como: `platform link (${link})` };
  }

  const vivosOuRecentes = async () => {
    // Reclamação chega DEPOIS do trabalho: job completed conta, cancelado não.
    const corte = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .not("status", "in", "(cancelled,deleted)")
      .is("deleted_at", null)
      .gte("scheduled_date", corte);
    return (data ?? []) as Job[];
  };

  if (r.postcode) {
    const pc = r.postcode.replace(/\s+/g, "").toUpperCase();
    const hits = (await vivosOuRecentes()).filter(
      (jb) => `${jb.property_address ?? ""}`.replace(/\s+/g, "").toUpperCase().includes(pc),
    );
    if (hits.length === 1) return { job: hits[0]!, como: `postcode ${r.postcode} (single job)` };
    if (hits.length > 1 && r.date) {
      const doDia = hits.filter((jb) => jb.scheduled_date === r.date);
      if (doDia.length === 1) return { job: doDia[0]!, como: `postcode + date ${r.date}` };
    }
  }
  if (r.clientName) {
    const hits = (await vivosOuRecentes()).filter((jb) =>
      `${jb.client_name ?? ""}`.toLowerCase().includes(r.clientName!.toLowerCase()),
    );
    if (hits.length === 1) return { job: hits[0]!, como: `client name "${r.clientName}" (single job)` };
  }
  return { job: null, como: "no unambiguous match" };
}

export type ResultadoReclamacao =
  | { acao: "hold"; reference: string; como: string; nota: string }
  | { acao: "nota"; nota: string }
  | { acao: "nada" };

/**
 * Trata um ticket já triado como `reclamacao`. Devolve o que fez e a nota
 * interna a postar no ticket da reclamação (quem posta é o chamador, que já
 * tem o postarNotaInterna e os tetos do ciclo).
 */
export async function tratarReclamacao(
  ticket: { id: number; subject: string },
  apiKey: string,
): Promise<ResultadoReclamacao> {
  const { texto, html } = await lerComentarios(ticket.id);
  const r = await classificarReclamacao(ticket.subject, texto, apiKey);
  if (!r.isReclamacao) return { acao: "nada" };

  const { job, como } = await acharJobDaReclamacao(r, html);
  const resumo = r.resumo ?? "Customer complaint (details in this ticket).";

  if (job && job.external_source === "zendesk" && job.external_ref?.trim()) {
    const hold = await putJobOnHoldFromZendesk({
      ticketId: job.external_ref.trim(),
      onHoldReasonId: "complaint",
      onHoldNotes: `${resumo} (raised in ticket #${ticket.id})`,
    });
    if (hold.ok && (hold.action === "put_on_hold" || hold.action === "already_on_hold")) {
      const oQueFez = hold.action === "put_on_hold" ? "put ON HOLD" : "was already on hold";
      return {
        acao: "hold",
        reference: job.reference,
        como,
        nota:
          `⚠️ HARVEY — complaint matched ${job.reference} via ${como}. Job ${oQueFez} ` +
          `(reason: complaint) and the partner was notified. Review and reply to the customer.`,
      };
    }
    return {
      acao: "nota",
      nota:
        `⚠️ HARVEY — complaint matched ${job.reference} via ${como}, but I could not put it on hold ` +
        `(${hold.ok ? hold.action : hold.error}). Apply the complaint macro by hand.`,
    };
  }

  if (job) {
    // Job achado mas sem ticket do Zendesk: a engine de hold é keyed no
    // ticket do job, então aqui é o humano que decide.
    return {
      acao: "nota",
      nota:
        `⚠️ HARVEY — complaint matched ${job.reference} via ${como}, but that job has no Zendesk ticket, ` +
        `so I did not touch it. Complaint: ${resumo}`,
    };
  }

  return {
    acao: "nota",
    nota:
      `⚠️ HARVEY — this reads as a complaint (${resumo}) but I could not match it to exactly one job ` +
      `(${como}). Find the job and apply the complaint macro.`,
  };
}
