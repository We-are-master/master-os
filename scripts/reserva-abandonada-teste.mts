/**
 * Teste de ponta a ponta da reserva abandonada com UM lead (o do dono).
 *
 *   npx tsx scripts/reserva-abandonada-teste.mts voce@exemplo.com
 *        ensaio: mostra o lead e o que mudaria (padrão, não grava nada)
 *   npx tsx scripts/reserva-abandonada-teste.mts voce@exemplo.com --aplicar
 *        o próximo toque vence AGORA; o resto segue a agenda de verdade
 *        (a folga de 12 horas entre e-mails continua valendo)
 *   npx tsx scripts/reserva-abandonada-teste.mts voce@exemplo.com --aplicar --rapido
 *        e liga o modo rápido (etiqueta `teste-rapido`): cada toque vence logo
 *        que o anterior sai, sem folga e sem a janela das 8h às 21h. Com o n8n
 *        de 10 em 10 minutos: E1, E2, E3 e WhatsApp em uns 40 minutos
 *   ... --aplicar --do-zero [--rapido]
 *        esquece o que já saiu (horários, código, resposta) e recomeça; apaga
 *        também o WhatsApp de retomada de TESTE deste e-mail, porque o índice
 *        único da 291 deixaria o segundo teste sem WhatsApp. O ticket continua
 *
 * Antes: comece uma reserva no site com o seu e-mail (e o seu celular no
 * passo 3), sem pagar. Use um e-mail que NÃO seja de agente do Zendesk: com
 * e-mail de agente o ticket fica com o Fixfy Team de solicitante e a sua
 * resposta conta como "o time respondeu".
 *
 * Quem manda é o motor (RESERVA_ABANDONADA=on na Vercel, n8n a cada 10 min).
 * Este script só mexe nos horários do lead. Lê o .env.local: fala com o banco
 * de PRODUÇÃO.
 */

import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const argumentos = process.argv.slice(2);
const email = argumentos.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const APLICAR = argumentos.includes("--aplicar");
const RAPIDO = argumentos.includes("--rapido");
const DO_ZERO = argumentos.includes("--do-zero");

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(1);
}

const { createServiceClient } = await import("../src/lib/supabase/service");
const { COLUNA_VENCE, enviadosDoLead, horariosDoTesteDePonta } = await import("../src/lib/site-leads/core");
const { folgaCumprida, NOME_DO_PASSO } = await import("../src/lib/site-leads/agenda");
const { leadTemWhatsApp, CAMPANHA_WHATSAPP } = await import("../src/lib/site-leads/whatsapp-lead");
const { toWhatsAppNumber } = await import("../src/lib/whatsapp/cloud");

const sb = createServiceClient();
const { data: leads, error } = await sb
  .from("site_leads")
  .select("*")
  .ilike("email", email)
  .in("status", ["new", "hot", "contacted"])
  .order("last_activity_at", { ascending: false })
  .limit(1);
if (error) throw new Error(error.message);
const lead = leads?.[0] as Record<string, unknown> | undefined;
if (!lead) {
  console.log(`Nenhum lead aberto com ${email}. Comece uma reserva no site com esse e-mail (sem pagar) e rode de novo.`);
  process.exit(1);
}

const hora = (v: unknown) =>
  v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(v))) : "·";

console.log(`Lead ${lead.id} · ${lead.status} · sequência ${lead.sequence_state} · canal ${lead.channel}`);
console.log(`  ${lead.full_name ?? "(sem nome)"} · ${lead.phone ?? "sem telefone"} · ${lead.service_label ?? "?"} · £${lead.price ?? "?"}`);
for (const p of [1, 2, 3, 4] as const) {
  const saiu = lead[["email1_sent_at", "email2_sent_at", "email3_sent_at", "whatsapp_sent_at"][p - 1]];
  console.log(`  ${NOME_DO_PASSO[p].padEnd(9)} ${saiu ? `saiu ${hora(saiu)}` : `vence ${hora(lead[COLUNA_VENCE[p]])}`}`);
}
if (lead.zendesk_ticket_id) console.log(`  Zendesk #${lead.zendesk_ticket_id}`);
if (lead.replied_at) console.log(`  respondeu ${hora(lead.replied_at)}`);

const agora = new Date();
const campos = horariosDoTesteDePonta(lead, agora, { rapido: RAPIDO, doZero: DO_ZERO });

console.log(`\nVai gravar${DO_ZERO ? " (do zero)" : ""}${RAPIDO ? " (modo rápido)" : ""}:`);
for (const [k, v] of Object.entries(campos)) console.log(`  ${k} = ${k.endsWith("_at") && v ? `${String(v)}  (${hora(v)})` : JSON.stringify(v)}`);

// Avisos que fariam o teste parecer quebrado sem estar.
const avisos: string[] = [];
if (lead.channel !== "website") avisos.push(`o canal é ${lead.channel}: o motor só trabalha lead do site`);
if (lead.status === "contacted" && !DO_ZERO) avisos.push("o lead está 'em contato': o motor não toca. Use --do-zero (ou Resume emails na aba Leads)");
if (lead.marketing_opt_out) avisos.push("o lead marcou 'Don't email me offers': a sequência para no primeiro toque");
if (!(Number(lead.price) > 0)) avisos.push("o lead não tem preço: a sequência para no primeiro toque");
const enviados = enviadosDoLead(DO_ZERO ? {} : lead);
const proximo = ([1, 2, 3, 4] as const).find((p) => !enviados[p] && campos[COLUNA_VENCE[p]] != null);
if (proximo && !RAPIDO && !folgaCumprida(proximo, enviados, agora)) {
  avisos.push(`sem --rapido a folga vale: o ${NOME_DO_PASSO[proximo]} não sai agora, o motor reagenda para a agenda normal`);
}
const { data: bloqueioEmail } = await sb.from("email_suppressions").select("reason").eq("email", email).maybeSingle();
if (bloqueioEmail) avisos.push(`o e-mail está na lista de bloqueio (${bloqueioEmail.reason}): nada sai`);
const fone = toWhatsAppNumber(lead.phone as string | null);
if (!leadTemWhatsApp(lead.phone as string | null)) avisos.push("sem passo 4: sem telefone válido ou sem WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID neste .env.local (a Vercel pode ter)");
if (fone) {
  const { data: bloqueioFone } = await sb.from("whatsapp_suppressions").select("reason").eq("phone", fone).maybeSingle();
  if (bloqueioFone) avisos.push(`o número está no bloqueio do WhatsApp (${bloqueioFone.reason}): o passo 4 não sai`);
  const { data: jaRecebeu } = await sb.from("marketing_touches").select("id, email").eq("channel", "whatsapp").eq("campaign", CAMPANHA_WHATSAPP).eq("phone", fone);
  if (jaRecebeu?.length && !DO_ZERO) avisos.push("este número já recebeu o WhatsApp de retomada: o passo 4 fecha sem mandar (--do-zero apaga o de teste)");
  if (jaRecebeu?.some((t) => String(t.email ?? "").toLowerCase() !== email)) avisos.push("o WhatsApp anterior deste número foi de OUTRO e-mail: --do-zero não apaga esse");
}
if (avisos.length) console.log(`\nAtenção:\n${avisos.map((a) => `  - ${a}`).join("\n")}`);

if (!APLICAR) {
  console.log("\nEnsaio. Para gravar: --aplicar");
  process.exit(0);
}

const { error: erroUpdate } = await sb.from("site_leads").update(campos).eq("id", lead.id as string);
if (erroUpdate) throw new Error(erroUpdate.message);
if (DO_ZERO && fone) {
  await sb.from("marketing_touches").delete().eq("channel", "whatsapp").eq("campaign", CAMPANHA_WHATSAPP).eq("phone", fone).ilike("email", email);
}
await sb.from("site_lead_activity").insert({
  lead_id: lead.id,
  kind: "note",
  detail: `End-to-end test: next touch due now${RAPIDO ? " (fast mode, no spacing)" : ""}${DO_ZERO ? ", started from scratch" : ""}.`,
});
console.log("\nGravado. O n8n manda na próxima volta (até 10 minutos). Acompanhe na aba Leads e no ticket do Zendesk.");
