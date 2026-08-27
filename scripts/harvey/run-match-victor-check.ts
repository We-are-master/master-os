// Descobre com que type of work o matching convida SÓ o parceiro Victor.
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
  import("../../src/lib/partner-work-matching"),
]).then(async ([{ createServiceClient }, { matchPartnerIdsForWork }]) => {
  const supabase = createServiceClient();
  const { data: victor } = await supabase
    .from("partners")
    .select("id, email, auth_user_id, catalog_service_ids, trades")
    .eq("company_name", "Victor")
    .maybeSingle();
  const v = victor as { id: string; email: string | null; auth_user_id: string | null; catalog_service_ids: string[] | null; trades: string[] | null };
  console.log("victor partner:", v.id, "| email:", v.email, "| portal login:", v.auth_user_id ? "linkado" : "SEM auth_user_id");
  const { data: cat } = await supabase
    .from("service_catalog")
    .select("id, name")
    .in("id", v.catalog_service_ids ?? []);
  const { data: nomes } = await supabase.from("partners").select("id, company_name").eq("status", "active");
  const nomePorId = new Map((nomes ?? []).map((p: { id: string; company_name: string | null }) => [p.id, p.company_name]));
  for (const c of (cat ?? []) as Array<{ id: string; name: string }>) {
    const ids = await matchPartnerIdsForWork(supabase, {
      serviceType: c.name,
      catalogServiceId: c.id,
      postcode: "EC1V 2NX",
      kind: "job",
    });
    const outros = ids.filter((id) => id !== v.id).map((id) => nomePorId.get(id) ?? id);
    console.log(`- ${c.name}: ${ids.length} match(es)${ids.includes(v.id) ? " [inclui Victor]" : " [NAO inclui Victor]"}${outros.length ? " + " + outros.join(", ") : " — SO O VICTOR ✓"}`);
  }
});
