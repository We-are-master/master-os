/**
 * Roda UM envio da Stefane no terminal, com o retorno na cara.
 *
 * A rota dispara e devolve 202: quando o envio não acontece e nada é gravado,
 * do lado de fora fica indistinguível de "ainda rodando". Aqui o retorno é
 * síncrono e um throw aparece inteiro.
 *
 *   npx tsx scripts/stefane-diagnostico-envio.mts JOB-9520          # dry run
 *   npx tsx scripts/stefane-diagnostico-envio.mts JOB-9520 --valendo # envia
 *   npx tsx scripts/stefane-diagnostico-envio.mts JOB-9536 --sem-minimo-de-fotos
 *
 * `--sem-minimo-de-fotos` pula O NOSSO mínimo por cômodo e pergunta à página
 * deles quantos campos ficam inválidos. Só funciona em dry run, de propósito.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { enviarRelatorioExterno } from "@/lib/stefane/run-external-report";

loadEnvLocal();

const ref = process.argv[2];
const valendo = process.argv.includes("--valendo");
const semMinimo = process.argv.includes("--sem-minimo-de-fotos");
if (!ref) throw new Error("uso: stefane-diagnostico-envio.mts JOB-XXXX [--valendo]");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: job } = await supabase.from("jobs").select("id, reference").eq("reference", ref).maybeSingle();
if (!job) throw new Error(`job ${ref} não encontrado`);

console.log(`${ref}: ${valendo ? "ENVIANDO DE VERDADE" : "dry run (não aperta Submit)"}`);
const r = await enviarRelatorioExterno(supabase as never, job.id, {
  simular: !valendo,
  ignorarMinimoDeFotos: semMinimo,
});
console.log("retorno:", JSON.stringify(r, null, 2));

const { data: depois } = await supabase
  .from("jobs")
  .select("external_report_started_at, external_report_submitted_at, external_report_error, external_report_attempts")
  .eq("id", job.id)
  .maybeSingle();
console.log("estado no banco:", JSON.stringify(depois, null, 2));
