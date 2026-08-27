import { readFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}
Promise.all([
  import("../../src/lib/supabase/service"),
  import("../../src/lib/partner-type-of-work-match"),
  import("../../src/lib/partner-coverage"),
]).then(async ([{ createServiceClient }, { partnerMatchesTypeOfWork }, { partnerCoversJob, isPartnerExcludedByPostcode, outwardFromPostcode }]) => {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("partners")
    .select("id, trade, trades, catalog_service_ids, status, excluded_postcodes, job_preferences, availability, coverage_mode, service_radius_miles, coverage_latitude, coverage_longitude, coverage_base_postcode, included_postcodes, coverage_cities, uk_coverage_regions, location")
    .in("id", ["7bf726ab-54aa-4c9d-827d-9ddaaebecfd5", "c575242e-5887-411e-ba5f-9180765c0202"]);
  const alvo = { postcode: "EC1V 2NX", latitude: 51.5273, longitude: -0.0889 };
  const outward = outwardFromPostcode("EC1V 2NX");
  for (const p of (data ?? []) as never[]) {
    const row = p as { id: string; catalog_service_ids: string[] | null; trades: string[] | null; trade: string | null };
    const cid = row.catalog_service_ids?.[0] ?? null;
    console.log("partner", row.id.slice(0, 8), "| trade:", row.trade, "| trades:", (row.trades ?? []).length, "| catalog:", (row.catalog_service_ids ?? []).length);
    console.log("  typeOfWork(primeiro catálogo):", partnerMatchesTypeOfWork(p, "whatever", cid));
    console.log("  excludedByPostcode:", isPartnerExcludedByPostcode(p, outward ?? ""));
    console.log("  coversJob:", partnerCoversJob(p, alvo));
  }
});
