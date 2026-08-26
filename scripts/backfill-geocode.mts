/**
 * Backfill de geocode: jobs vivos sem lat/lng e casas de parceiros ativos sem
 * partner_address_latitude. Usa a MESMA lib do servidor (OpenCage → Mapbox
 * fallback). Idempotente: só toca quem não tem coordenada. Uso:
 *   npx tsx scripts/backfill-geocode.mts            # aplica
 *   npx tsx scripts/backfill-geocode.mts --dry-run  # só mostra
 */
import { readFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}
const dry = process.argv.includes("--dry-run");

const [{ createServiceClient }, { geocodeUkAddressServer }] = await Promise.all([
  import("../src/lib/supabase/service"),
  import("../src/lib/job-geocode-server"),
]);
const supabase = createServiceClient();

// ── jobs vivos sem coordenada ──
const { data: jobs } = await supabase
  .from("jobs")
  .select("id, reference, property_address")
  .is("latitude", null)
  .is("deleted_at", null)
  .not("property_address", "is", null)
  .not("status", "in", "(cancelled,deleted,completed)");
let jobsOk = 0, jobsFail = 0;
for (const j of (jobs ?? []) as Array<{ id: string; reference: string; property_address: string }>) {
  const geo = await geocodeUkAddressServer(j.property_address);
  if (!geo) { jobsFail++; console.log(`✗ ${j.reference}: sem geocode para "${j.property_address.slice(0, 60)}"`); continue; }
  if (!dry) {
    const { error } = await supabase.from("jobs").update({ latitude: geo.latitude, longitude: geo.longitude }).eq("id", j.id);
    if (error) { jobsFail++; console.log(`✗ ${j.reference}: write falhou ${error.message}`); continue; }
  }
  jobsOk++;
  console.log(`✓ ${j.reference} → ${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}${dry ? " (dry)" : ""}`);
}

// ── casas dos parceiros ativos ──
const { data: partners } = await supabase
  .from("partners")
  .select("id, company_name, partner_address, coverage_base_postcode, partner_address_latitude")
  .eq("status", "active")
  .is("partner_address_latitude", null);
let pOk = 0, pFail = 0;
for (const p of (partners ?? []) as Array<{ id: string; company_name: string | null; partner_address: string | null; coverage_base_postcode: string | null }>) {
  const alvo = p.partner_address?.trim() || p.coverage_base_postcode?.trim();
  if (!alvo) { pFail++; console.log(`✗ ${p.company_name}: sem endereço nem postcode base`); continue; }
  const geo = await geocodeUkAddressServer(alvo);
  if (!geo) { pFail++; console.log(`✗ ${p.company_name}: sem geocode para "${alvo.slice(0, 50)}"`); continue; }
  if (!dry) {
    const { error } = await supabase
      .from("partners")
      .update({ partner_address_latitude: geo.latitude, partner_address_longitude: geo.longitude })
      .eq("id", p.id);
    if (error) { pFail++; console.log(`✗ ${p.company_name}: write falhou ${error.message}`); continue; }
  }
  pOk++;
  console.log(`✓ home ${p.company_name} (${alvo.slice(0, 40)}) → ${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}${dry ? " (dry)" : ""}`);
}
console.log(`\njobs: ${jobsOk} geocodados, ${jobsFail} sem solução · partners: ${pOk} casas geocodadas, ${pFail} pendentes`);
