/**
 * Desenha o email das 20h com DADOS REAIS e não manda nada.
 *
 * Preview de email com dado inventado mente sobre o resultado: endereço curto,
 * um job só, nenhum atrasado. O que decide se este email funciona é justamente
 * o caso feio, com endereço de duas linhas e três dias de atraso, então o
 * ensaio lê a base.
 *
 * Escreve o HTML num arquivo e imprime o caminho. Nada de Resend aqui.
 *
 *   npx tsx scripts/preview-missing-reports-email.mts                  # o parceiro com mais report faltando
 *   npx tsx scripts/preview-missing-reports-email.mts "RJ Cleaner"     # um parceiro
 *   npx tsx scripts/preview-missing-reports-email.mts --todos          # a lista de quem receberia
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

const { buildPartnerMissingReportsEmail } = await import("@/lib/emails/partner-missing-reports-email");
const { createPartnerReportToken } = await import("@/lib/quote-response-token");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const BASE = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.getfixfy.com";
const PORTAL = "https://partners.getfixfy.com";

/**
 * Quem entra na cobrança: job com parceiro, já trabalhado, sem relatório final
 * e sem dispensa. `final_report_skipped` fica de fora porque dispensa é
 * decisão do escritório, e cobrar o que a gente mesmo dispensou queima o email.
 */
const { data: jobs, error } = await supabase
  .from("jobs")
  .select(
    "id, reference, title, property_address, client_name, scheduled_date, partner_id, partner_cost, " +
      "final_report_submitted, report_submitted, final_report_skipped, status",
  )
  .not("partner_id", "is", null)
  .eq("status", "final_check")
  .is("deleted_at", null)
  .order("scheduled_date", { ascending: true })
  .limit(400);

if (error) throw new Error(error.message);

const pendentes = (jobs ?? []).filter(
  (j) => !j.final_report_submitted && !j.report_submitted && !j.final_report_skipped,
);

const { data: parceiros } = await supabase.from("partners").select("id, contact_name, company_name");
const nomeDoParceiro = new Map(
  (parceiros ?? []).map((p) => [
    p.id as string,
    ((p.contact_name as string | null)?.trim() || (p.company_name as string | null)?.trim() || "there"),
  ]),
);

const porParceiro = new Map<string, typeof pendentes>();
for (const j of pendentes) {
  const k = String(j.partner_id);
  porParceiro.set(k, [...(porParceiro.get(k) ?? []), j]);
}

if (process.argv.includes("--todos")) {
  console.log(`${porParceiro.size} parceiro(s) receberiam, ${pendentes.length} report(s) no total:\n`);
  for (const [id, lista] of [...porParceiro].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(nomeDoParceiro.get(id)).padEnd(28)} ${String(lista.length).padStart(2)} report(s)`);
  }
  process.exit(0);
}

const filtro = process.argv[2]?.toLowerCase();
const escolhido = filtro
  ? [...porParceiro].find(([id]) => String(nomeDoParceiro.get(id)).toLowerCase().includes(filtro))
  : [...porParceiro].sort((a, b) => b[1].length - a[1].length)[0];

if (!escolhido) {
  console.log(filtro ? `nenhum parceiro casa com "${filtro}"` : "ninguém com report pendente agora");
  process.exit(0);
}

const [partnerId, lista] = escolhido;
const hoje = new Date();
const diasDesde = (iso: string | null): number => {
  if (!iso) return 0;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return Math.max(0, Math.round((hoje.getTime() - d.getTime()) / 86_400_000));
};
const rotuloDeData = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${String(iso).slice(0, 10)}T12:00:00Z`))
    : "No date";

/** £1121 sai "£1,121.00": numero de milhar sem separador no assunto le mal. */
const libras = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const total = lista.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0);

const { subject, html, text } = buildPartnerMissingReportsEmail({
  partnerFirstName: String(nomeDoParceiro.get(partnerId) ?? "there").split(" ")[0]!,
  onHoldDisplay: total > 0 ? libras(total) : null,
  portalUrl: PORTAL,
  jobs: lista.map((j) => ({
    reference: String(j.reference ?? ""),
    title: String(j.title ?? "Job"),
    address: String(j.property_address ?? ""),
    clientFirstName: String(j.client_name ?? "").trim().split(" ")[0] || null,
    dateLabel: rotuloDeData(j.scheduled_date as string | null),
    daysWaiting: diasDesde(j.scheduled_date as string | null),
    payDisplay: Number(j.partner_cost ?? 0) > 0 ? libras(Number(j.partner_cost)) : null,
    reportUrl: `${BASE}/job/report?token=${encodeURIComponent(
      createPartnerReportToken(String(j.id), String(j.partner_id)),
    )}`,
  })),
});

const saida = process.env.PREVIEW_OUT?.trim() || "/tmp/missing-reports-email.html";
writeFileSync(saida, html);
console.log(`parceiro : ${nomeDoParceiro.get(partnerId)}`);
console.log(`reports  : ${lista.length}`);
console.log(`assunto  : ${subject}`);
console.log(`html     : ${saida}\n`);
console.log(text);
