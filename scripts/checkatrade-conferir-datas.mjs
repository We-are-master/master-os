#!/usr/bin/env node
/**
 * A data que está no OS bate com a que o Checkatrade mandou por e-mail?
 *
 * Em 23/08/2026 oito jobs futuros estavam um dia ANTES do que o cliente tinha
 * marcado. A causa era o navegador do RPA herdar o fuso do Mac (São Paulo) e
 * ler a data-sem-hora do slot um dia atrás; está consertada em
 * `checkatrade-rpa/src/checkatrade/auth.ts`, que agora fixa Europe/London.
 *
 * Este script existe porque a causa consertada não é garantia: ele confere o
 * RESULTADO. Qualquer deriva futura, venha de onde vier — outra mudança de
 * fuso, o Checkatrade mudando o formato, cliente remarcando sem ninguém ver —
 * aparece aqui no dia seguinte, e não num telefonema de cliente.
 *
 * A verdade é o e-mail "You're booked in for ... through Checkatrade Express",
 * que o Checkatrade renderiza NO SERVIDOR, em hora de Londres, e que é o mesmo
 * que o cliente enxerga no app dele:
 *
 *     📍Location: N10 1LP
 *     💰 Earnings: £86.50
 *     📅 Arrival Time: Tuesday, 1 September 2026 - Evening (4:00 PM - 8:00 PM)
 *
 * O casamento é por POSTCODE + VALOR EXATO, que dá 1:1. Só postcode confunde
 * job cancelado e remarcado no mesmo endereço, que foi o falso positivo da
 * primeira medição.
 *
 * Job cancelado fica de fora: quando o cliente remarca, o Checkatrade cancela o
 * job A e cria o job B um dia depois. Casar o e-mail novo com o job A velho
 * inventa uma divergência que não existe.
 *
 *   node scripts/checkatrade-conferir-datas.mjs
 *
 * Sai com código 1 quando acha divergência, para poder virar alerta.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const zd = `https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const auth = "Basic " + Buffer.from(`${env.ZENDESK_EMAIL}/token:${env.ZENDESK_API_TOKEN}`).toString("base64");
const SB = String(env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY };

const MES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const hojeLdn = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const postcodeDe = (s) => ((String(s).match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i) ?? [""])[0]).replace(/\s+/g, "").toUpperCase();
const emLondres = (iso) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "--:--";

// ── A verdade: os e-mails de confirmação ─────────────────────────────────
const busca = await (await fetch(`${zd}/search.json?query=${encodeURIComponent('type:ticket "booked in for"')}&per_page=100`, { headers: { authorization: auth } })).json();
const emails = [];
for (const t of busca.results ?? []) {
  const c = await (await fetch(`${zd}/tickets/${t.id}/comments.json`, { headers: { authorization: auth } })).json();
  const corpo = String(c.comments?.[0]?.plain_body ?? "").replace(/[͏‌​­]/g, "").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ");
  const arr = corpo.match(/Arrival Time:\s*(\w+day),\s*(\d{1,2})\s+(\w+)\s+(\d{4})\s*-\s*([^\n]*)/i);
  if (!arr) continue;
  const mes = MES[arr[3].toLowerCase()];
  if (!mes) continue;
  const loc = corpo.match(/Location:\s*([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);
  const ganho = corpo.match(/Earnings:\s*£\s*([\d,.]+)/i);
  emails.push({
    ticket: t.id,
    emitidoEm: t.created_at,
    ymd: `${arr[4]}-${String(mes).padStart(2, "0")}-${String(arr[2]).padStart(2, "0")}`,
    janela: arr[5].trim().replace(/\s+/g, " ").slice(0, 34),
    postcode: (loc?.[1] ?? "").replace(/\s+/g, "").toUpperCase(),
    valor: ganho ? Number(ganho[1].replace(/,/g, "")) : null,
  });
}

// ── O que está no OS ─────────────────────────────────────────────────────
const jobs = await (await fetch(
  `${SB}/rest/v1/jobs?select=reference,client_name,status,partner_name,property_address,client_price,scheduled_date,scheduled_start_at,scheduled_end_at&deleted_at=is.null&cancelled_at=is.null&scheduled_date=gte.${hojeLdn}&limit=300`,
  { headers: SH },
)).json();

// Primeiro casa tudo, depois julga. Julgar dentro do laço fazia o mesmo job
// ser cobrado por dois e-mails diferentes: quando o cliente remarca, o
// Checkatrade manda um e-mail novo e o antigo continua na caixa, os dois com o
// mesmo endereço e o mesmo valor. Visto na Michelle B, E13 0BQ.
const porJob = new Map();
for (const e of emails.filter((x) => x.ymd >= hojeLdn)) {
  if (e.valor == null || !e.postcode) continue;
  const casados = jobs.filter((j) => postcodeDe(j.property_address) === e.postcode && Math.abs(Number(j.client_price) - e.valor) < 0.01);
  // Mais de um job para o mesmo e-mail: endereço com dois jobs do mesmo valor.
  // Não chuta. Confirmação errada manda parceiro para o dia errado, que é o
  // problema que este script existe para impedir.
  if (casados.length !== 1) continue;
  const j = casados[0];
  if (!porJob.has(j.reference)) porJob.set(j.reference, { job: j, emails: [] });
  porJob.get(j.reference).emails.push(e);
}

const divergentes = [];
const ambiguos = [];
for (const { job: j, emails: es } of porJob.values()) {
  if (es.length > 1) {
    // Dois e-mails para o mesmo job. O mais NOVO costuma ser a remarcação, mas
    // "costuma" não serve para mandar parceiro à rua: fica para o humano.
    if (!es.some((e) => e.ymd === j.scheduled_date)) {
      ambiguos.push({ job: j, datas: es.map((e) => e.ymd).sort() });
    }
    continue;
  }
  const e = es[0];
  if (j.scheduled_date === e.ymd) continue;
  divergentes.push({ ...e, job: j, dias: Math.round((new Date(e.ymd) - new Date(j.scheduled_date)) / 864e5) });
}
const conferidos = porJob.size;

console.log(`\nCheckatrade x OS · ${conferidos} job(s) futuros conferidos contra o e-mail deles\n`);
for (const a of ambiguos) {
  console.log(`  ? ${a.job.reference}  ${a.job.client_name}: dois e-mails (${a.datas.join(" e ")}) e o OS em ${a.job.scheduled_date}. Confira à mão qual valeu.\n`);
}
if (divergentes.length === 0) {
  console.log(ambiguos.length ? "  Nenhuma divergência clara.\n" : "  Todos batem. Data e janela iguais ao que o cliente recebeu.\n");
  process.exit(ambiguos.length ? 1 : 0);
}
for (const d of divergentes) {
  console.log(`  ${d.job.reference}  ${d.job.client_name}`);
  console.log(`     OS diz:          ${d.job.scheduled_date}  ${emLondres(d.job.scheduled_start_at)} - ${emLondres(d.job.scheduled_end_at)}`);
  console.log(`     Checkatrade diz: ${d.ymd}  ${d.janela}   (${d.dias > 0 ? "+" : ""}${d.dias} dia)`);
  console.log(`     parceiro: ${d.job.partner_name ?? "nenhum"} · status ${d.job.status} · ticket #${d.ticket}\n`);
}
console.log(`  ${divergentes.length} divergência(s). A data do e-mail é a que o cliente vê no app dele.\n`);
process.exit(1);
