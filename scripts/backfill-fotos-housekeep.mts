/**
 * Fotos do card da Housekeep nos jobs que nasceram sem elas (25/10/2026).
 *
 *   npx tsx scripts/backfill-fotos-housekeep.mts            # ENSAIO: lista o que acharia
 *   npx tsx scripts/backfill-fotos-housekeep.mts --gravar   # grava no bucket e em jobs.images
 *
 * Só job da Housekeep ainda aberto (nem concluído, nem cancelado), sem foto e
 * com o link do card. Não manda e-mail a ninguém.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const gravar = process.argv.includes("--gravar");
const { fotosDoCardHousekeep } = await import("../src/lib/zendesk-quoter/fotos-housekeep");
const { guardarFotosDoTicket } = await import("../src/lib/zendesk-quoter/guardar-fotos");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });
const HOUSEKEEP = "9659bbfb-eb56-4a31-9773-7f5e1335d0b4";

const { data, error } = await sb
  .from("jobs")
  .select("id, reference, status, external_ref, report_link, images")
  .eq("account_id", HOUSEKEEP)
  .is("deleted_at", null)
  .not("status", "in", "(completed,cancelled,awaiting_payment)")
  .order("created_at", { ascending: false })
  .limit(100);
if (error) throw new Error(error.message);

for (const j of data ?? []) {
  const imgs = Array.isArray(j.images) ? j.images : [];
  if (imgs.length || !j.report_link) continue;
  const fotos = await fotosDoCardHousekeep(j.report_link);
  if (!fotos.length) { console.log(`  · ${j.reference} ${j.status}: card sem foto`); continue; }
  if (!gravar) { console.log(`  → ${j.reference} ${j.status}: ${fotos.length} foto(s) no card`); continue; }
  const urls = await guardarFotosDoTicket(String(j.external_ref ?? j.id), fotos, sb, "housekeep");
  const { error: e } = await sb.from("jobs").update({ images: urls }).eq("id", j.id).eq("images", "[]");
  console.log(e ? `  ✗ ${j.reference}: ${e.message}` : `  ✓ ${j.reference}: ${urls.length} foto(s) gravadas`);
}
console.log(gravar ? "feito" : "ENSAIO: nada gravado (use --gravar)");
