/**
 * Contexto do envio no ticket da conversa (dono, 27/10/2026, #51865).
 *
 * O OS manda WhatsApp direto pela API (lembrete de véspera, cobrança de quote) e
 * anota o envio no ticket do job. Quando o cliente responde, o Zendesk abre um
 * ticket novo "Conversation with…" sem a mensagem nossa nem o job: a equipe abre
 * e não sabe do que se trata. Ticket de plataforma (Housekeep) não entra na
 * conversa do morador (ticketDoProprioCliente), então o caminho é uma nota
 * interna com o que foi enviado, o job e os links.
 *
 * Puro: quem busca e grava é `anotarContextoDoEnvio` (zendesk-wa.ts).
 */

export type EnvioRecente = {
  dedupe_key: string;
  purpose: string;
  job_id: string | null;
  quote_id: string | null;
  zendesk_ticket_id: number | string | null;
  template: string | null;
  sent_at: string | null;
  reserved_at: string;
};

export type JobDoEnvio = {
  id: string;
  reference: string;
  title: string | null;
  property_address: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  scheduled_date: string | null;
  external_source: string | null;
  external_ref: string | null;
};

/** Só o que nasceu de um job ou de uma quote: o template de lead tem a junção própria (harvey_wa_leads). */
export function envioComContexto(e: EnvioRecente): boolean {
  return !!(e.job_id || e.quote_id);
}

/** Tag por envio: a mesma conversa recebe nota de um lembrete novo, nunca duas do mesmo. */
export function tagDoEnvio(e: EnvioRecente): string {
  const base = (e.job_id ?? e.quote_id ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const quando = (e.sent_at ?? e.reserved_at).slice(0, 10).replace(/-/g, "");
  return `ctx_${e.purpose.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${base}_${quando}`;
}

const ROTULO: Record<string, string> = {
  "lembrete-24h": "day-before reminder",
};

function rotulo(purpose: string): string {
  if (ROTULO[purpose]) return ROTULO[purpose];
  if (purpose.startsWith("quote-chase")) return "quote follow-up";
  return purpose.replace(/-/g, " ");
}

function horaDeLondres(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function janela(j: JobDoEnvio): string | null {
  if (!j.scheduled_start_at) return j.scheduled_date;
  const dia = new Date(j.scheduled_start_at).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
  const h = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return j.scheduled_end_at ? `${dia}, ${h(j.scheduled_start_at)}-${h(j.scheduled_end_at)}` : `${dia}, ${h(j.scheduled_start_at)}`;
}

/** O ticket do job no Zendesk, quando ele mora lá. */
export function ticketDoJob(j: JobDoEnvio | null): number | null {
  return j && j.external_source === "zendesk" && /^\d+$/.test(j.external_ref ?? "") ? Number(j.external_ref) : null;
}

export function notaDoContexto(
  e: EnvioRecente,
  telefone: string,
  job: JobDoEnvio | null,
  base = { zendesk: "https://fixfy.zendesk.com", os: "https://app.getfixfy.com" },
): string {
  const linhas = [`🔗 Context: the customer is replying to our ${rotulo(e.purpose)} on WhatsApp, sent ${horaDeLondres(e.sent_at ?? e.reserved_at)} to ${telefone}${e.template ? ` (template ${e.template})` : ""}.`];
  if (job) {
    linhas.push(`Job: ${[job.reference, job.title, janela(job), job.property_address].filter(Boolean).join(" · ")}`);
    const t = ticketDoJob(job);
    if (t) linhas.push(`Job ticket (full history): #${t} ${base.zendesk}/agent/tickets/${t}`);
    linhas.push(`OS: ${base.os}/jobs/${job.id}`);
  } else if (e.zendesk_ticket_id) {
    linhas.push(`Ticket: #${e.zendesk_ticket_id} ${base.zendesk}/agent/tickets/${e.zendesk_ticket_id}`);
  }
  return linhas.join("\n");
}
