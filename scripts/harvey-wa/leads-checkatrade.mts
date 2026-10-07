/**
 * Primeiro contato do Harvey para os leads do Checkatrade que já estão no OS.
 *
 * O Ruben grava cada lead em `clients` (marcador `checkatrade-lead:<id>`). A
 * rota /api/contacts/ingest manda na hora para os novos; este script pega o
 * acumulado (leads de antes, ou que chegaram fora de 8h-20h).
 *
 *   npx tsx scripts/harvey-wa/leads-checkatrade.mts                  ensaio: lista quem iria receber
 *   npx tsx scripts/harvey-wa/leads-checkatrade.mts --enviar         manda
 *   --dias=14        leads criados nos últimos N dias (padrão 14)
 *   --limite=50      no máximo N envios nesta rodada (padrão 50)
 *   --intervalo=20   segundos entre envios (padrão 20)
 *
 * Seguro de rodar de novo: quem já recebeu (ou já conversa com o Harvey) é
 * pulado. Só manda das 8h às 20h de Londres. Para sozinho depois de 3 falhas
 * seguidas (template errado, número bloqueado): insistir só queimaria leads.
 */
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { createServiceClient } = await import("../../src/lib/supabase/service");
const { decidirLead, mandarPrimeiroContato, templateDoLeadConfigurado, jaFalamosComEle, telefoneE164 } = await import("../../src/lib/harvey-wa/primeiro-contato");
const { ajustesDoHarvey, janelaAberta } = await import("../../src/lib/harvey-wa/ajustes");

const arg = (nome: string, padrao: number) => Number(process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1] ?? padrao);
const ENVIAR = process.argv.includes("--enviar");
const DIAS = arg("dias", 14);
const LIMITE = arg("limite", 50);
const INTERVALO = arg("intervalo", 20);

if (ENVIAR && !templateDoLeadConfigurado()) {
  console.log("Falta HARVEY_WA_LEAD_TEMPLATE no .env.local (o nome do template aprovado).");
  process.exit(1);
}
const ajustes = await ajustesDoHarvey();
if (ENVIAR && !janelaAberta(ajustes)) {
  console.log(`Fora da janela (${ajustes.janelaInicio}h-${ajustes.janelaFim}h de Londres): nada sai agora.`);
  process.exit(0);
}

const sb = createServiceClient();
const { data: catRows } = await sb.from("service_catalog").select("*").is("deleted_at", null).eq("is_active", true);
const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
const { data: leads, error } = await sb
  .from("clients")
  .select("id,full_name,email,phone,postcode,address,notes,created_at")
  .ilike("notes", "%checkatrade-lead:%")
  .gte("created_at", desde)
  .order("created_at", { ascending: false })
  .limit(1000);
if (error) throw new Error(error.message);

const contagem: Record<string, number> = {};
const conta = (k: string) => (contagem[k] = (contagem[k] ?? 0) + 1);
let enviados = 0;
let falhasSeguidas = 0;
const vistos = new Set<string>();

console.log(`${leads?.length ?? 0} lead(s) do Checkatrade nos últimos ${DIAS} dias. ${ENVIAR ? "ENVIANDO" : "Ensaio (nada sai)"}.\n`);

for (const r of leads ?? []) {
  if (enviados >= LIMITE) break;
  const d = decidirLead(r as never, (catRows ?? []) as never);
  if (d.kind === "pular") {
    conta(`pulado: ${d.motivo}`);
    continue;
  }
  const tel = telefoneE164(d.contato.telefone);
  if (!tel || vistos.has(tel)) {
    conta(tel ? "pulado: mesmo telefone de outro lead" : "pulado: telefone inválido");
    continue;
  }
  vistos.add(tel);
  if (await jaFalamosComEle(sb, tel)) {
    conta("pulado: já falamos");
    continue;
  }
  const linha = `${d.contato.nome} · ${tel} · ${d.contato.servico} · ${d.contato.area}`;
  if (!ENVIAR) {
    console.log(`  → ${linha}`);
    conta("iria receber");
    enviados++;
    continue;
  }
  const res = await mandarPrimeiroContato(sb, d.contato);
  console.log(`  ${res.kind === "enviado" ? "✅" : res.kind === "ja_falamos" ? "·" : "❌"} ${linha}${res.kind === "falhou" ? `  (${res.motivo})` : ""}`);
  conta(res.kind);
  if (res.kind === "falhou") {
    if (++falhasSeguidas >= 3) {
      console.log("\n3 falhas seguidas: parei. Confira o template e o número antes de rodar de novo.");
      break;
    }
    continue;
  }
  falhasSeguidas = 0;
  if (res.kind === "enviado") {
    enviados++;
    await new Promise((ok) => setTimeout(ok, INTERVALO * 1000));
  }
}

console.log("\nResumo:");
for (const [k, n] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
