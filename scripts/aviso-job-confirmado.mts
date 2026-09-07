/**
 * O aviso "job confirmado" para a organização, cobrado por varredura.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * O e-mail já existia e é bom: "Hi Housekeep, this job is booked and
 * scheduled", com data, janela, endereço e tipo de trabalho. Quem monta é o
 * `dispatchJobCreatedZendesk`, e ele é idempotente — carimba
 * `job_creation_notice_sent_at` antes de mandar, então chamar duas vezes não
 * manda duas vezes.
 *
 * O problema nunca foi o e-mail. Foi QUEM chama.
 *
 * Hoje ele é disparado de dentro do navegador (`notifyPartnerJobChange` faz
 * `fetch` de uma tela). Ou seja: só sai quando um humano atribui parceiro
 * clicando. Job que ganha parceiro por agente, por API, por auto-assign, ou
 * cuja aba fechou antes do fetch terminar, fica sem aviso e ninguém percebe —
 * não existe alarme para e-mail que não saiu.
 *
 * E tem uma segunda armadilha, escrita no próprio `dispatchJobCreatedZendesk`:
 * job criado como `unassigned` sai de lá SEM carimbar, de propósito, "para uma
 * transição posterior para scheduled ainda poder mandar a confirmação". Só que
 * ninguém vigia essa transição. O comentário descreve um vigia que nunca foi
 * escrito. É este arquivo.
 *
 * Medido em 03/09/2026: dos 130 jobs agendados de agosto para cá com ticket e
 * parceiro, 81 receberam o aviso e 49 não. 38% de silêncio.
 *
 * ─── Por que varredura e não gatilho ─────────────────────────────────────
 *
 * Porque gatilho pendurado num caminho é exatamente o defeito que se está
 * consertando. A varredura pergunta pelo ESTADO ("este job está agendado, tem
 * parceiro, tem ticket, e nunca foi avisado?") e não pelo evento. Todo caminho
 * novo de atribuição que alguém inventar amanhã já nasce coberto.
 *
 *   npx tsx scripts/aviso-job-confirmado.mts            # ensaio
 *   npx tsx scripts/aviso-job-confirmado.mts --aplicar
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const APLICAR = process.argv.includes("--aplicar");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

/** Os mesmos status que o `dispatchJobCreatedZendesk` aceita. */
const STATUS_QUE_CONTAM = ["scheduled", "late"];

/**
 * Não avisamos job que já passou.
 *
 * "Your job is confirmed for 19 August" chegando em setembro, num job já
 * concluído e pago, não é um aviso: é um susto. O silêncio de agosto fica
 * como está, registrado e não corrigido — a varredura serve para daqui para
 * a frente.
 */
function hojeLondres(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const hoje = hojeLondres();

const { data, error } = await sb
  .from("jobs")
  .select("id, reference, status, scheduled_date, partner_id, external_source, external_ref, job_creation_notice_sent_at")
  .is("deleted_at", null)
  .in("status", STATUS_QUE_CONTAM)
  .is("job_creation_notice_sent_at", null)
  .not("partner_id", "is", null)
  .eq("external_source", "zendesk")
  .not("external_ref", "is", null)
  .gte("scheduled_date", hoje)
  .order("scheduled_date");
if (error) throw new Error(error.message);

const pendentes = (data ?? []) as Array<{
  id: string;
  reference: string;
  status: string;
  scheduled_date: string;
  external_ref: string;
}>;

console.log(`\naviso "job confirmado" — jobs de ${hoje} em diante, com parceiro e ticket, ainda sem aviso: ${pendentes.length}`);
for (const j of pendentes) {
  console.log(`  ${j.reference.padEnd(9)} ${j.scheduled_date} ${j.status.padEnd(10)} ticket ${j.external_ref}`);
}

if (pendentes.length === 0) {
  console.log("\nnada a fazer.\n");
  process.exit(0);
}

if (!APLICAR) {
  console.log("\n(ensaio — nada enviado. Use --aplicar)\n");
  process.exit(0);
}

const { dispatchJobCreatedZendesk } = await import("../src/lib/zendesk-lifecycle");

let enviados = 0;
let pulados = 0;
for (const j of pendentes) {
  try {
    const r = await dispatchJobCreatedZendesk({ jobId: j.id, client: sb as never });
    if (r.skipped) {
      pulados++;
      console.log(`  · ${j.reference}: pulado (${r.skipped})`);
    } else if (r.ok) {
      enviados++;
      console.log(`  ✔ ${j.reference}: avisado`);
    } else {
      console.log(`  ✖ ${j.reference}: ${r.error}`);
    }
  } catch (err) {
    console.error(`  ✖ ${j.reference}:`, err);
  }
}
console.log(`\n${enviados} avisado(s), ${pulados} pulado(s)\n`);
