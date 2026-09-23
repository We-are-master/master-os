/**
 * Operação da campanha pelo terminal (WEEK10).
 *
 *   npx tsx scripts/campanha.mts --montar                  # ensaio: quantos em cada grupo
 *   npx tsx scripts/campanha.mts --montar --aplicar        # grava a fila
 *   npx tsx scripts/campanha.mts --teste=email@x.com,447700900123 [--aplicar]
 *        fila de teste com UMA pessoa (o dono): e-mail agora e WhatsApp
 *        MARKETING_FOLLOWUP_MIN depois (use 2 no teste). Grupo "teste".
 *   npx tsx scripts/campanha.mts --email [--forcar]        # uma volta de e-mail agora
 *   npx tsx scripts/campanha.mts --zendesk                 # ensaio da varredura de respostas
 *
 * Lê o .env.local; fala com o banco de produção.
 */

import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const arg = (k: string) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const valor = (k: string) => arg(k)?.split("=").slice(1).join("=");
const APLICAR = Boolean(arg("aplicar"));

const { montarFila, voltaDeEmail } = await import("../src/lib/marketing/campanha");
const { createServiceClient } = await import("../src/lib/supabase/service");
const { varrerRespostasDoZendesk } = await import("../src/lib/marketing/zendesk-respostas");
const { toWhatsAppNumber } = await import("../src/lib/whatsapp/cloud");

if (arg("montar")) {
  console.log(JSON.stringify(await montarFila({ aplicar: APLICAR }), null, 2));
  if (!APLICAR) console.log("\nEnsaio. Para gravar: --aplicar");
} else if (arg("teste")) {
  const [email, fone] = (valor("teste") ?? "").split(",");
  const phone = toWhatsAppNumber(fone);
  if (!email || !phone) throw new Error("--teste=email,telefone");
  const sb = createServiceClient();
  const { data: cli } = await sb.from("clients").select("id, full_name").ilike("email", email.trim()).is("deleted_at", null).limit(1).maybeSingle();
  if (!cli) throw new Error(`nenhum cliente com o e-mail ${email}: crie um no OS antes do teste`);
  const agora = new Date().toISOString();
  const nome = String(cli.full_name ?? "").split(/\s+/)[0] || "there";
  const linhas = [
    { campanha: "week10", client_id: cli.id, grupo: "teste", canal: "email", passo: "email_quente", email: email.trim().toLowerCase(), phone: null, primeiro_nome: nome, agendado_para: agora },
    { campanha: "week10", client_id: cli.id, grupo: "teste", canal: "whatsapp", passo: "wa_followup", email: null, phone, primeiro_nome: nome, agendado_para: null },
    { campanha: "week10", client_id: cli.id, grupo: "teste", canal: "whatsapp", passo: "wa_oferta", email: null, phone, primeiro_nome: nome, agendado_para: agora },
    { campanha: "week10", client_id: cli.id, grupo: "teste", canal: "email", passo: "email_oferta", email: email.trim().toLowerCase(), phone: null, primeiro_nome: nome, agendado_para: agora },
  ];
  console.log(linhas.map((l) => `${l.canal.padEnd(8)} ${l.passo}`).join("\n"));
  if (APLICAR) {
    const { error } = await sb.from("marketing_queue").upsert(linhas, { onConflict: "campanha,passo,client_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    console.log("\nFila de teste gravada. O n8n (ou --email --forcar) manda.");
  } else console.log("\nEnsaio. Para gravar: --aplicar");
} else if (arg("email")) {
  console.log(await voltaDeEmail({ forcar: Boolean(arg("forcar")) }));
} else if (arg("zendesk")) {
  console.log(JSON.stringify(await varrerRespostasDoZendesk({ aplicar: APLICAR, minutos: Number(valor("minutos") ?? "60") }), null, 2));
} else {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
}
