// Simula o day-route do G&M Services amanhã: dados + Directions multi-parada.
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
  import("../../src/lib/mapbox-directions"),
]).then(async ([{ createServiceClient }, { getDrivingRouteMulti, formatDuration, formatDistanceMiles }]) => {
  const supabase = createServiceClient();
  const { data: p } = await supabase
    .from("partners")
    .select("id, company_name, partner_address_latitude, partner_address_longitude, partner_address, coverage_base_postcode")
    .eq("company_name", "G&M Services")
    .maybeSingle();
  const partner = p as { id: string; company_name: string; partner_address_latitude: number | null; partner_address_longitude: number | null };
  const { data: jobs } = await supabase
    .from("jobs")
    .select("reference, title, latitude, longitude, scheduled_start_at, scheduled_end_at")
    .eq("partner_id", partner.id)
    .eq("scheduled_date", "2026-08-25")
    .is("deleted_at", null)
    .not("status", "in", "(cancelled,deleted)")
    .order("scheduled_start_at", { ascending: true });
  const stops = (jobs ?? []) as Array<{ reference: string; title: string; latitude: number | null; longitude: number | null; scheduled_start_at: string | null }>;
  console.log("casa:", partner.partner_address_latitude ? "geocodada" : "SEM COORD");
  for (const s of stops) console.log("-", s.reference, s.title, s.latitude != null ? "coord ok" : "SEM COORD", s.scheduled_start_at?.slice(11, 16));
  const way = [
    ...(partner.partner_address_latitude != null ? [{ latitude: partner.partner_address_latitude, longitude: partner.partner_address_longitude! }] : []),
    ...stops.filter((s) => s.latitude != null).map((s) => ({ latitude: s.latitude!, longitude: s.longitude! })),
  ];
  const rota = await getDrivingRouteMulti(way);
  if (!rota) { console.log("SEM ROTA"); return; }
  console.log(`rota: ${formatDuration(rota.durationSec)} · ${formatDistanceMiles(rota.distanceM)} · ${rota.geometry.coordinates.length} pontos`);
  rota.legs.forEach((l, i) => console.log(`  perna ${i + 1}: ${formatDuration(l.durationSec)} · ${formatDistanceMiles(l.distanceM)}`));
});
