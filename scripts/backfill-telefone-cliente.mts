/**
 * Preenche o telefone do morador nos jobs que nasceram sem ele.
 *
 *   npx tsx scripts/backfill-telefone-cliente.mts            ← dry run
 *   npx tsx scripts/backfill-telefone-cliente.mts --gravar   ← grava
 *
 * O e-mail que abre o ticket da Housekeep não traz nome nem telefone: os dados
 * do morador moram atrás do link do card. O Harvey passou a capturar o contato
 * em 22/08/2026, mas os jobs criados antes disso ficaram sem, e sem telefone
 * não há confirmação por WhatsApp nem como avisar de um atraso.
 *
 * Lê o contato da API do card, que devolve o campo estruturado, em vez de
 * adivinhar do texto renderizado.
 *
 * NUNCA sobrescreve um telefone que já existe: o que está lá pode ter sido
 * corrigido à mão, e a página é a fonte de origem, não a mais recente.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

const gravar = process.argv.includes("--gravar");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

type Detalhe = { label?: string; value?: unknown };
type Secao = { title?: string; details?: Detalhe[] };

/** O uuid do card vive na URL final, depois do link rastreado da newsletter. */
async function uuidDoCard(link: string): Promise<string | null> {
  try {
    const r = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return r.url.match(/job-reports\/([0-9a-f]{16,})/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function contatoDoCard(uuid: string): Promise<string | null> {
  const r = await fetch(`https://housekeep.com/api/v1/work/job-reports/${uuid}/`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { visit_details?: { visit_details_sections?: Secao[] } };
  for (const sec of j.visit_details?.visit_details_sections ?? []) {
    for (const d of sec.details ?? []) {
      if (String(d.label ?? "").trim().toLowerCase() === "contact") {
        const v = String(d.value ?? "").trim();
        if (v) return v;
      }
    }
  }
  return null;
}

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("reference, client_id, client_name, report_link")
  .not("client_id", "is", null)
  .not("report_link", "is", null);
if (error) throw new Error(error.message);

const ids = [...new Set((jobs ?? []).map((j) => j.client_id))] as string[];
const semFone = new Set<string>();
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await supabase.from("clients").select("id, phone").in("id", ids.slice(i, i + 200));
  for (const c of data ?? []) if (!String(c.phone ?? "").trim()) semFone.add(c.id as string);
}

const alvos = (jobs ?? []).filter((j) => semFone.has(j.client_id as string));
console.log(`${alvos.length} job(s) com cliente sem telefone e com link do card\n`);

let achou = 0;
const jaFeito = new Set<string>();
for (const j of alvos) {
  if (jaFeito.has(j.client_id as string)) continue;
  const uuid = await uuidDoCard(String(j.report_link));
  if (!uuid) {
    console.log(`  · ${j.reference}  link não resolveu para um card`);
    continue;
  }
  const fone = await contatoDoCard(uuid);
  if (!fone) {
    console.log(`  · ${j.reference}  o card não mostra contato`);
    continue;
  }
  achou++;
  jaFeito.add(j.client_id as string);
  console.log(`  ✓ ${j.reference}  ${j.client_name}: ${fone}`);
  if (gravar) {
    // `.is("phone", null)` não basta: a coluna guarda string vazia também.
    const { error: e } = await supabase
      .from("clients")
      .update({ phone: fone })
      .eq("id", j.client_id)
      .or("phone.is.null,phone.eq.");
    if (e) console.log(`      ✗ ${e.message}`);
  }
}

console.log(`\n${gravar ? "GRAVADO" : "DRY RUN (nada foi alterado)"} · ${achou} telefone(s) encontrado(s)`);
if (!gravar && achou > 0) console.log("Para gravar: --gravar\n");
