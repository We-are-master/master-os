#!/usr/bin/env node
/**
 * Reescreve o `report_link` das vendas do Mike: chave de dedupe vira URL da
 * conversa no respond.io.
 *
 * Ate 24/08/2026 o Alex gravava `respondio:lead:<uuid>`. Aquilo e a chave de
 * idempotencia dele, nao um endereco: no OS o campo virava link morto, e o
 * uuid la dentro e do lead do CHECKATRADE, do qual nao se deriva conversa
 * nenhuma sem consultar a API do respond.io.
 *
 * Por isso este script existe em vez de uma traducao no OS: a ponte
 * lead -> contato so existe do lado do respond.io, e e ele quem responde.
 *
 * E por isso ele roda JUNTO com a mudanca do Alex, nao depois: a API do OS
 * deduplica por `report_link` exato. Trocar o formato sem reescrever os
 * antigos faria o proximo ciclo do Alex nao reconhecer os jobs da Jennifer, da
 * Marilyn e da Catherine, e criar tudo de novo.
 *
 *   node scripts/backfill-report-link-conversa.mjs            # so mostra
 *   node scripts/backfill-report-link-conversa.mjs --aplicar  # escreve
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const APLICAR = process.argv.includes("--aplicar");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Za-z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "content-type": "application/json" };
const ESPACO = (env.RESPONDIO_SPACE_ID ?? "456341").trim();

/** Todos os contatos, seguindo a URL do `next` (o `cursorId` remontado repete
 *  a primeira pagina, e o laco para achando que acabou). */
async function todosOsContatos() {
  const body = JSON.stringify({ search: "", filter: { $and: [] }, timezone: "Europe/London" });
  const vistos = new Map();
  let url = "https://api.respond.io/v2/contact/list?limit=100";
  for (let i = 0; i < 30; i++) {
    const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${env.RESPONDIO_API_KEY}`, "content-type": "application/json" }, body });
    const j = await r.json();
    const antes = vistos.size;
    for (const c of j.items ?? []) vistos.set(c.id, c);
    if (vistos.size === antes || !j.pagination?.next) break;
    url = j.pagination.next;
  }
  return [...vistos.values()];
}

const jobs = await (await fetch(`${SB}/rest/v1/jobs?select=id,reference,client_name,report_link&report_link=like.respondio:lead:*`, { headers: H })).json();
if (!jobs.length) {
  console.log("nenhum job no formato velho. nada a fazer.");
  process.exit(0);
}

const contatos = await todosOsContatos();
const porLead = new Map();
for (const c of contatos) {
  const v = (c.custom_fields ?? []).find((f) => f.name === "checkatrade_lead_id")?.value;
  if (typeof v === "string" && v) porLead.set(v, c);
}

let ok = 0, semContato = 0;
for (const j of jobs) {
  const lead = String(j.report_link).replace(/^respondio:lead:/, "");
  const c = porLead.get(lead);
  if (!c) {
    // Sem contato o link nao existe, e inventar um id seria pior que o campo
    // morto: um link que abre a conversa de OUTRA pessoa.
    console.log(`  ⚑ ${j.reference} ${String(j.client_name).padEnd(20)} lead ${lead} sem contato no respond.io — deixado como esta`);
    semContato++;
    continue;
  }
  const novo = `https://app.respond.io/space/${ESPACO}/inbox/${c.id}`;
  console.log(`  ${APLICAR ? "✓" : "→"} ${j.reference} ${String(j.client_name).padEnd(20)} ${j.report_link}\n      ${novo}`);
  if (APLICAR) {
    const r = await fetch(`${SB}/rest/v1/jobs?id=eq.${j.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ report_link: novo }) });
    if (!r.ok) { console.log(`      FALHOU: ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
  }
  ok++;
}
console.log(`\n${APLICAR ? "" : "[seco] "}${ok} job(s)${semContato ? `, ${semContato} sem contato` : ""}.`);
