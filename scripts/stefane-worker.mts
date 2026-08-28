/**
 * STEFANE WORKER — o braço local que envia o que a Vercel só enfileira.
 *
 * O envio da Housekeep abre um Chromium (Playwright), e Chromium não existe
 * numa function serverless: o clique de produção explodia com "Cannot find
 * module /var/task/.../browsers.json" e queimava tentativas num erro que nunca
 * ia mudar (JOB-9519, 27/08). Mesmo desenho do Express: o site diz o que
 * fazer; quem tem o navegador — este Mac — faz.
 *
 * A cada passada, varre os jobs elegíveis da Housekeep ainda não enviados e
 * chama o MESMO `enviarRelatorioExterno` do botão. Toda a inteligência mora
 * lá: elegibilidade, trava de concorrência com validade, teto de tentativas,
 * confirmação pelo `submitted_at` DELES, e-mails de resultado. Aqui só se
 * escolhe quem entra na esteira.
 *
 *   npx tsx scripts/stefane-worker.mts            # uma passada
 *
 * Agendado pelo launchd (com.fixfy.stefane-worker, a cada 2 min). Rodadas
 * sobrepostas não duplicam envio: a trava por job em `started_at` decide.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { enviarRelatorioExterno } from "@/lib/stefane/run-external-report";

loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const { data: candidatos, error } = await supabase
  .from("jobs")
  .select("id, reference, status, external_report_attempts")
  .ilike("report_link", "%housekeep%")
  .eq("final_report_submitted", true)
  .eq("report_1_approved", true)
  .is("external_report_submitted_at", null)
  .is("external_report_manual_at", null)
  .lt("external_report_attempts", 3)
  .in("status", ["final_check", "awaiting_payment", "completed"])
  .is("deleted_at", null)
  .order("scheduled_date", { ascending: true })
  .limit(10);
if (error) throw new Error(error.message);

if (!candidatos?.length) {
  console.log(`[stefane-worker] ${new Date().toISOString()} fila vazia`);
  process.exit(0);
}

console.log(`[stefane-worker] ${new Date().toISOString()} ${candidatos.length} candidato(s)`);
for (const c of candidatos) {
  // Um de cada vez: cada envio abre um Chromium, e dois Chromium disputando o
  // Mac durante o expediente é lentidão para todo mundo.
  const r = await enviarRelatorioExterno(supabase as never, c.id);
  console.log(`  ${c.reference}: ${r.estado}${r.motivo ? ` — ${r.motivo}` : ""}${r.segundos ? ` (${r.segundos}s)` : ""}`);
  // Não-elegível é decisão, não erro: fotos faltando, horário impossível, já
  // enviado à mão. O motivo já foi gravado no card por quem decidiu.
}
