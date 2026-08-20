#!/usr/bin/env node
/**
 * Abre no Zendesk o ticket que faltou em jobs já criados, e liga os dois.
 *
 * Faz exatamente o que o bloco `create_zendesk_ticket` do POST /api/jobs faz:
 * ticket com nota PRIVADA, requester do time, tags os-created/os-job, e depois
 * a mesma tríade de sync (status, notice, form fields). Job sem ticket não é
 * job: é registro que ninguém no escritório vê.
 *
 *   npx tsx scripts/fantastic-abrir-ticket.mts JOB-9479 JOB-9480
 */
import { readFileSync } from "node:fs";
import { loadEnvLocal } from "./load-env-local.mjs";

/**
 * `loadEnvLocal` lê `.env` ANTES do `.env.local` e não sobrescreve o que já
 * existe. O `.env` guarda um ZENDESK_API_TOKEN velho (entre aspas), então todo
 * script que carrega assim fala com o Zendesk usando token morto e leva 401,
 * enquanto o servidor Next (que dá prioridade ao `.env.local`) funciona. Aqui
 * as credenciais do Zendesk vêm do `.env.local` na marra.
 */
function zendeskCredsFromEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!key.startsWith("ZENDESK_")) continue;
    process.env[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const refs = process.argv.slice(2).filter((a) => a.startsWith("JOB-"));
if (!refs.length) {
  console.error("uso: npx tsx scripts/fantastic-abrir-ticket.mts JOB-1234 [JOB-1235...]");
  process.exit(1);
}

async function main() {
  loadEnvLocal();
  zendeskCredsFromEnvLocal();
  const { createServiceClient } = await import("../src/lib/supabase/service");
  const { createTicket, ZENDESK_REPLY_STATUS_FIELD_ID, ZENDESK_REPLY_STATUS_SENT_VALUE } =
    await import("../src/lib/zendesk");
  const { appBaseUrl } = await import("../src/lib/app-base-url");
  const { syncJobZendeskStatus } = await import("../src/lib/zendesk-status-sync");
  const { dispatchJobCreatedZendesk } = await import("../src/lib/zendesk-lifecycle");
  const { syncJobZendeskFormFields } = await import("../src/lib/zendesk-ticket-form-sync");

  const supabase = createServiceClient();

  for (const ref of refs) {
    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, reference, title, client_name, property_address, scope, client_price, scheduled_date, scheduled_start_at, external_source, external_ref, status")
      .eq("reference", ref)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !job) { console.error(`${ref}: não encontrado (${error?.message ?? "sem linha"})`); continue; }
    if (job.external_ref) { console.log(`${ref}: já tem ticket ${job.external_ref}, nada a fazer`); continue; }

    const startUk = job.scheduled_start_at
      ? new Date(job.scheduled_start_at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
      : "";
    const detailLines = [
      `Job no OS: ${appBaseUrl()}/jobs/${job.id}`,
      `Customer: ${job.client_name}`,
      `Address: ${job.property_address}`,
      `Scheduled: ${String(job.scheduled_date).slice(0, 10)} ${startUk}`.trim(),
      job.client_price ? `Value: £${job.client_price}` : null,
      job.scope ? `\n${job.scope}` : null,
    ].filter(Boolean) as string[];

    const customFields = ZENDESK_REPLY_STATUS_FIELD_ID > 0
      ? [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: ZENDESK_REPLY_STATUS_SENT_VALUE }]
      : undefined;

    const t = await createTicket({
      subject: `${job.reference} · ${job.title} · ${job.client_name}`,
      commentBody: detailLines.join("\n"),
      publicComment: false,
      requesterEmail: "team@getfixfy.com",
      requesterName: "Fixfy Team",
      tags: ["os-created", "os-job", "webhook-job"],
      externalId: String(job.id),
      customFields,
    });
    if (!t.ok || !t.id) { console.error(`${ref}: createTicket falhou — ${t.error}`); continue; }

    const { error: linkErr } = await supabase
      .from("jobs")
      .update({ external_source: "zendesk", external_ref: String(t.id) })
      .eq("id", job.id);
    if (linkErr) { console.error(`${ref}: ticket ${t.id} aberto mas o link falhou — ${linkErr.message}`); continue; }

    const [st, notice, form] = await Promise.all([
      syncJobZendeskStatus(String(job.id), supabase),
      dispatchJobCreatedZendesk({ jobId: String(job.id), client: supabase }),
      syncJobZendeskFormFields(String(job.id), supabase),
    ]);
    console.log(`${ref}: ticket ${t.id} aberto e ligado · status=${JSON.stringify(st)} notice=${JSON.stringify(notice)} form=${JSON.stringify(form)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
