/**
 * O agente de marketing pelo terminal.
 *
 *   npx tsx scripts/agente-marketing.mts --plano                 # o calendário: 26 edições + relâmpagos, sem tocar em nada
 *   npx tsx scripts/agente-marketing.mts --previa=out/           # grava o HTML de cada e-mail para abrir no navegador
 *   npx tsx scripts/agente-marketing.mts --lista [--aplicar]     # sincroniza a lista "Fixfy Clients" na Resend
 *   npx tsx scripts/agente-marketing.mts --clube [--aplicar]     # cria os broadcasts como RASCUNHO na Resend
 *   npx tsx scripts/agente-marketing.mts --clube --agendar --aplicar   # e põe a hora em cada um
 *   npx tsx scripts/agente-marketing.mts --manha [--aplicar]     # a rotina da manhã inteira
 *   npx tsx scripts/agente-marketing.mts --tarde [--aplicar]     # o WhatsApp do relâmpago no ar
 *   npx tsx scripts/agente-marketing.mts --teste-wa=447700900123 --relampago=paint15   # UM WhatsApp, para o seu número
 *   npx tsx scripts/agente-marketing.mts --b2b-onda=1 [--aplicar]             # segmento "Fixfy B2B · Wave 1" com 200 agências
 *   npx tsx scripts/agente-marketing.mts --b2b=1 [--agendar] [--aplicar]      # os 16 broadcasts da onda no Resend
 *   npx tsx scripts/agente-marketing.mts --template              # o texto do template para submeter à Meta
 *
 * Sem --aplicar é ensaio. Lê o .env.local; fala com o banco de produção e com a Resend de verdade.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
// O logo do e-mail é servido pelo OS de produção: o endereço local não abre na caixa de ninguém.
process.env.NEXT_PUBLIC_APP_URL = "https://app.getfixfy.com";

const arg = (k: string) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const valor = (k: string) => arg(k)?.split("=").slice(1).join("=");
const APLICAR = Boolean(arg("aplicar"));

const cal = await import("../src/lib/marketing/agente/calendario");
const clube = await import("../src/lib/marketing/agente/clube");
const lista = await import("../src/lib/marketing/agente/lista");
const relampago = await import("../src/lib/marketing/agente/relampago");
const agente = await import("../src/lib/marketing/agente/index");
const b2b = await import("../src/lib/marketing/agente/b2b");
const { segmentoPeloNome } = await import("../src/lib/marketing/agente/resend");

const hora = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

if (arg("plano")) {
  console.log("CLUBE · terça e sexta, 10h de Londres\n");
  for (const e of cal.CLUBE) {
    const p = clube.pecaDaEdicao(e);
    console.log(`  ${hora(cal.quandoSaiAEdicao(e)).padEnd(22)} ${p.etiqueta.padEnd(11)} ${(p.cupom ?? "").padEnd(14)} ${p.assunto}`);
  }
  console.log("\nRELÂMPAGOS · quarta 11h (e-mail) e 15h (WhatsApp), até quinta 23:59\n");
  for (const r of cal.RELAMPAGOS) console.log(`  ${hora(cal.abreEm(r)).padEnd(22)} ${r.codigo.padEnd(8)} ${r.percentual}% · ${r.maxUsos} usos · fecha ${hora(cal.fechaEm(r))} · ${r.email.assunto}`);
  console.log(`\nLista hoje: até ${lista.tetoDaLista()} contatos · WhatsApp por relâmpago: ${relampago.tetoDoWhatsApp()}`);
} else if (arg("previa")) {
  const dir = valor("previa") || "previa-agente";
  mkdirSync(dir, { recursive: true });
  for (const e of cal.CLUBE) writeFileSync(join(dir, `${e.dia}-${e.key}.html`), clube.htmlDaEdicao(clube.pecaDaEdicao(e)));
  for (const r of cal.RELAMPAGOS) writeFileSync(join(dir, `${r.dia}-flash-${r.slug}.html`), relampago.htmlDoRelampago(r));
  for (const e of b2b.SEQUENCIA_B2B) writeFileSync(join(dir, `b2b-${String(e.n).padStart(2, "0")}-${e.key}.html`), b2b.htmlDoB2B(e));
  console.log(`${cal.CLUBE.length + cal.RELAMPAGOS.length + b2b.SEQUENCIA_B2B.length} e-mails em ${dir}/`);
} else if (arg("lista")) {
  console.log(JSON.stringify(await lista.sincronizarLista({ aplicar: APLICAR, maxOperacoes: Number(valor("max") ?? "5000") }), null, 2));
} else if (arg("clube")) {
  const segmento = await segmentoPeloNome(lista.NOME_DO_SEGMENTO, false);
  if (!segmento) console.log(`A lista "${lista.NOME_DO_SEGMENTO}" ainda não existe na Resend: rode --lista --aplicar antes.\n`);
  const linhas = await clube.montarClube({ aplicar: APLICAR, agendar: Boolean(arg("agendar")), segmento });
  for (const l of linhas) console.log(`  ${l.dia}  ${l.estado.padEnd(12)} ${l.key.padEnd(22)} ${l.detalhe ?? ""}`);
} else if (arg("b2b-onda")) {
  console.log(JSON.stringify(await b2b.montarOnda({ onda: Number(valor("b2b-onda") || 1), aplicar: APLICAR }), null, 2));
} else if (arg("b2b")) {
  const onda = b2b.ONDAS.find((o) => o.n === Number(valor("b2b") || 1));
  if (!onda) throw new Error("onda desconhecida: acrescente em ONDAS (b2b.ts)");
  const segmento = await segmentoPeloNome(b2b.nomeDaOnda(onda.n), false);
  if (!segmento) console.log(`O segmento "${b2b.nomeDaOnda(onda.n)}" ainda não existe: rode --b2b-onda=${onda.n} --aplicar antes.\n`);
  for (const l of await b2b.montarB2B({ aplicar: APLICAR, agendar: Boolean(arg("agendar")), onda: onda.n, inicio: onda.inicio, segmento }))
    console.log(`  ${String(l.n).padStart(2)}  ${hora(new Date(l.quando)).padEnd(22)} ${l.estado.padEnd(12)} ${l.assunto} ${l.detalhe ?? ""}`);
} else if (arg("manha")) {
  console.log(JSON.stringify(await agente.rodarManha({ aplicar: APLICAR }), null, 2));
} else if (arg("tarde")) {
  console.log(JSON.stringify(await agente.rodarTarde({ aplicar: APLICAR }), null, 2));
} else if (arg("teste-wa")) {
  const r = cal.RELAMPAGOS.find((x) => x.slug === (valor("relampago") ?? cal.RELAMPAGOS[0].slug));
  if (!r) throw new Error("relâmpago desconhecido");
  const { enviarTemplatePeloZendesk } = await import("../src/lib/harvey-wa/template-zendesk");
  console.log(await enviarTemplatePeloZendesk({ to: valor("teste-wa") ?? "", name: relampago.TEMPLATE_DO_WHATSAPP.nome, language: relampago.TEMPLATE_DO_WHATSAPP.idioma, bodyParams: ["there", r.linha, r.codigo, "Thursday at midnight"], buttonUrlParam: r.codigo }));
} else if (arg("template")) {
  console.log(JSON.stringify(relampago.TEMPLATE_DO_WHATSAPP, null, 2));
} else {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
}
