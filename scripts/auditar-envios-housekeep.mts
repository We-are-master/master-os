/**
 * Audita os jobs marcados como "enviados" na Housekeep, abrindo o link real.
 *
 * O detector antigo lia a página 4 segundos depois do Submit — no meio do
 * upload — e uma heurística posterior aceitou "o botão sumiu" como sucesso.
 * Resultado: `external_report_submitted_at` gravado em job cujo relatório
 * nunca entrou (o usuário pegou o de 09:13 no olho). Este script separa o
 * verde verdadeiro do falso: página ainda com formulário e Submit = rascunho,
 * não relatório.
 *
 * Com `--limpar`, zera o carimbo dos falsos (e anota o motivo no erro) para
 * eles voltarem à fila de reenvio.
 *
 *   npx tsx scripts/auditar-envios-housekeep.mts [--limpar]
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);
const limpar = process.argv.includes("--limpar");

const { data: jobs } = await supabase
  .from("jobs")
  .select("id, reference, client_name, status, report_link, external_report_submitted_at")
  .not("external_report_submitted_at", "is", null)
  .ilike("report_link", "%housekeep.com/job-reports%")
  .order("external_report_submitted_at", { ascending: false })
  .limit(40);

console.log(`${jobs?.length ?? 0} job(s) marcados como enviados na Housekeep\n`);
const browser = await chromium.launch({ headless: true });
const falsos: Array<{ id: string; reference: string }> = [];

for (const j of jobs ?? []) {
  const page = await browser.newPage();
  try {
    await page.goto(String(j.report_link).split("?")[0], { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);
    const texto = await page.locator("body").innerText();
    const campos = await page.locator("input, textarea").count();
    const temSubmit = await page.locator('button[type="submit"]').count();
    const confirmado = /report submitted|already submitted|thank you|received your report/i.test(texto);
    // Formulário aberto com Submit é rascunho; sem campos, ou com texto de
    // confirmação, o relatório entrou.
    const deVerdade = confirmado || (campos === 0 && temSubmit === 0);
    const hora = String(j.external_report_submitted_at).slice(0, 16).replace("T", " ");
    console.log(
      `${deVerdade ? "✓ ok   " : "✗ FALSO"}  ${j.reference}  ${hora}  ${j.status}  ${j.client_name ?? ""}`,
    );
    if (!deVerdade) falsos.push({ id: String(j.id), reference: String(j.reference) });
  } catch (err) {
    console.log(`? erro   ${j.reference}  ${err instanceof Error ? err.message.slice(0, 60) : err}`);
  } finally {
    await page.close();
  }
}
await browser.close();

console.log(`\n${falsos.length} falso(s) positivo(s).`);
if (limpar && falsos.length) {
  for (const f of falsos) {
    await supabase
      .from("jobs")
      .update({
        external_report_submitted_at: null,
        external_report_error:
          "audit 17/08: marked as sent, but the Housekeep form is still a draft — needs resend",
      })
      .eq("id", f.id);
    console.log(`limpo: ${f.reference}`);
  }
} else if (falsos.length) {
  console.log("Rode com --limpar para zerar o carimbo e devolvê-los à fila.");
}
