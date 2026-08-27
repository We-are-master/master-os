// Acha serviços do catálogo que não casam com NENHUM parceiro ativo (para o
// teste supervisionado usar um deles sem convidar parceiro real).
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
]).then(async ([{ createServiceClient }, { partnerMatchesTypeOfWork }]) => {
  const supabase = createServiceClient();
  const [{ data: partners }, { data: catalog }] = await Promise.all([
    supabase
      .from("partners")
      .select("id, company_name, trade, trades, catalog_service_ids, status")
      .eq("status", "active"),
    supabase.from("service_catalog").select("id, name").is("deleted_at", null),
  ]);
  const semDono: string[] = [];
  for (const c of (catalog ?? []) as Array<{ id: string; name: string }>) {
    const casam = ((partners ?? []) as never[]).filter((p) =>
      partnerMatchesTypeOfWork(p, c.name, c.id),
    );
    if (casam.length === 0) semDono.push(c.name);
  }
  console.log(`${semDono.length} serviço(s) sem nenhum parceiro ativo:`);
  for (const n of semDono.slice(0, 15)) console.log("-", n);
});
