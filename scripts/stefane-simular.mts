/** Preenche o formulário da Housekeep de um job real SEM submeter. */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { payloadDoReport, payloadLimpeza } from "../src/lib/stefane/housekeep-report-form";
import { submeterRelatorioHousekeep } from "../src/lib/stefane/submit-housekeep-report";
for (const f of [".env",".env.local"]) { try { for (const l of readFileSync(f,"utf8").split("\n")) { const m=l.match(/^([A-Z_0-9]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"").trim(); } } catch{} }
const ref = process.argv[2];
if (!ref) throw new Error("uso: npx tsx scripts/stefane-simular.mts JOB-9349");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
const { data: j } = await sb.from("jobs")
  .select("reference,title,report_link,start_report,final_report,partner_timer_started_at,partner_timer_ended_at")
  .eq("reference", ref).maybeSingle();
if (!j) throw new Error("job não encontrado");
const limpeza = /clean|tenancy/i.test(String(j.title));
const base = { inicio: j.partner_timer_started_at as string|null, fim: j.partner_timer_ended_at as string|null };
const r = limpeza
  ? payloadLimpeza({ start: j.start_report as any, final: j.final_report as any, ...base })
  : payloadDoReport({ final: j.final_report as any, ...base });
console.log(`${ref} · ${j.title} · ${limpeza ? "limpeza" : "trade"}`);
if (!r.ok) { console.log(`  NÃO ENVIÁVEL: ${r.motivo}`); process.exit(0); }
console.log("  payload:", JSON.stringify(r.payload));
const res = await submeterRelatorioHousekeep({ url: String(j.report_link).split("?")[0], payload: r.payload, simular: true });
console.log(`  resultado: ${JSON.stringify(res)}`);
