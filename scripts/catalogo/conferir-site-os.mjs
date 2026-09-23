#!/usr/bin/env node
/**
 * Confere se o site B2C e o catálogo do OS cobram e pagam o mesmo, nos dois
 * sentidos. O site não consulta o OS na hora de criar o job: ele manda o
 * preço e o repasse que calcula sozinho (pricing.js e server/b2c/partner-pay.js),
 * e o OS tem as mesmas faixas gravadas no service_catalog. Os dois lados
 * precisam bater, senão o job nasce com um valor e a tela do OS mostra outro.
 *
 * 1. Do site para o OS: tudo o que o site vende (cada tipo de limpeza em cada
 *    tamanho com 1 banheiro, a escada de banheiros, cada add-on, pintura,
 *    reparo e certificado) precisa ter faixa ou add-on ativo com o mesmo
 *    preço E o mesmo repasse. Falta ou diferença sai com código 1.
 * 2. Do OS para o site: faixa do OS que o site sabe calcular (ex.: 3 bed ·
 *    2 bath) também tem de bater. As que o site não vende (hora avulsa,
 *    diária de pintura, CP12 de 2 a 4 aparelhos, EICR 5-6) só são listadas.
 *
 * O serviço do OS é achado pelo título que o site manda, do jeito do /api/jobs
 * (nome exato, depois o apelido da lista canônica em src/lib/type-of-work.ts).
 *
 * Lê o site de um checkout local do master-website, vizinho deste repo, ou do
 * caminho em MASTER_WEBSITE_DIR. Só lê: nada é gravado em lugar nenhum.
 *
 *   node scripts/catalogo/conferir-site-os.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "../load-env-local.mjs";
// A mesma função que o /api/jobs usa para ligar o service_type ao catálogo.
import { catalogServiceIdForTypeOfWorkLabel } from "../../src/lib/type-of-work.ts";

loadEnvLocal();

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.MASTER_WEBSITE_DIR || path.resolve(aqui, "../../../master-website");
const P = await import(pathToFileURL(path.join(SITE, "src/b2c/content/pricing.js")).href);
const { partnerPayFor } = await import(pathToFileURL(path.join(SITE, "server/b2c/partner-pay.js")).href);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e a service role key no .env.local");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: rows, error } = await supabase
  .from("service_catalog")
  .select("id,name,pricing_presets,pricing_addons")
  .eq("is_active", true)
  .is("deleted_at", null);
if (error) throw error;

/**
 * O serviço do OS para um título do site, achado como o /api/jobs acha: nome
 * exato, depois o apelido da lista canônica. Em 23/09/2026 o dono renomeou
 * "Electrical Safety Report" para "Electrical Installation Condition Report"
 * e o job do site continuou ligando pelo apelido; conferir por nome exato
 * dava falta onde não havia.
 */
const servico = new Proxy({}, {
  get: (_, titulo) => {
    const id = typeof titulo === "string" ? catalogServiceIdForTypeOfWorkLabel(titulo, rows) : null;
    return rows.find((r) => r.id === id);
  },
});

/** O que o site cobra e paga num cenário (só as linhas daquele serviço). */
function site(sel, service, extra = {}) {
  const p = P.priceSelection(sel);
  const lines = p.lines.filter((l) => l.service === service);
  return {
    price: lines.reduce((s, l) => s + (l.amount || 0), 0),
    pay: partnerPayFor({ service, lines, size: p.selection.size, kind: p.selection.clean?.kind, bathrooms: p.selection.bathrooms, ...extra }),
  };
}

// Títulos do próprio site (osTitle): renomear lá ou aqui não descola a conferência.
const KIND = Object.fromEntries(P.CLEAN.kinds.map((k) => [k.id, k.osTitle]));
const SIZE_LABEL = { studio: "Studio", 1: "1 bed", 2: "2 bed", 3: "3 bed", 4: "4 bed", 5: "5 bed" };
const EXTRA_ADDON = { carpet: "Carpet steam clean (per room)", fridge: "Fridge freezer", windows: "Windows outside", balcony: "Balcony, terrace or patio" };
const ORDEM = ["2nd", "3rd", "4th"];

let ok = 0;
let dif = 0;
const vistos = new Set();
const faixa = (nome, label) => (servico[nome]?.pricing_presets || []).find((f) => f.label === label);
const addon = (nome, label) => (servico[nome]?.pricing_addons || []).find((a) => a.label === label);

/** Libra com no máximo duas casas: 60% de £38 sai £22,80, não £22.80000000000001. */
const gbp = (n) => (n == null ? "?" : Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Compara um item do site com a faixa ou add-on do OS; registra o que foi visto. */
function conferir(onde, nome, label, item, esperado) {
  const rotulo = `${servico[nome]?.name ?? nome} · ${label}`;
  vistos.add(`${onde}|${servico[nome]?.name ?? nome}|${label}`);
  if (!item) {
    dif++;
    console.log(`FALTA  ${rotulo}: o site vende a £${gbp(esperado.price)} (parceiro £${gbp(esperado.pay)}) e o OS não tem`);
    return;
  }
  if (item.fixed_price === esperado.price && item.partner_cost === esperado.pay) {
    ok++;
    return;
  }
  dif++;
  console.log(`DIF    ${rotulo}: OS £${item.fixed_price}/£${item.partner_cost}, site £${gbp(esperado.price)}/£${gbp(esperado.pay)}`);
}

// ─── 1. Do site para o OS ────────────────────────────────────────────────────

for (const [kind, nome] of Object.entries(KIND)) {
  // Cada tamanho com 1 banheiro.
  for (const size of Object.keys(SIZE_LABEL)) {
    const s = site({ services: ["clean"], size, bathrooms: 1, clean: { kind } }, "clean");
    if (s.price == null || !s.pay) continue;
    const label = `${SIZE_LABEL[size]} · 1 bath`;
    conferir("faixa", nome, label, faixa(nome, label), s);
  }
  // A escada de banheiros: 2º, 3º e 4º, cada degrau contra o add-on.
  for (let b = 2; b <= 4; b++) {
    const com = site({ services: ["clean"], size: "studio", bathrooms: b, clean: { kind } }, "clean");
    const sem = site({ services: ["clean"], size: "studio", bathrooms: b - 1, clean: { kind } }, "clean");
    const label = `Extra bathroom, ${ORDEM[b - 2]}`;
    conferir("addon", nome, label, addon(nome, label), { price: com.price - sem.price, pay: com.pay - sem.pay });
  }
  // Add-ons de limpeza, uma unidade de cada.
  const base = site({ services: ["clean"], size: "studio", clean: { kind } }, "clean");
  for (const e of P.CLEAN.extras) {
    const com = site({ services: ["clean"], size: "studio", clean: { kind, extras: { [e.id]: 1 } } }, "clean");
    const label = EXTRA_ADDON[e.id] || e.label;
    conferir("addon", nome, label, addon(nome, label), { price: com.price - base.price, pay: com.pay - base.pay });
  }
}

// Pintura: touch-up, um cômodo e o pacote de material.
{
  const touch = site({ services: ["paint"], paint: { option: "touchup", rooms: 1 } }, "paint");
  const nome = P.PAINT.osTitle;
  conferir("faixa", nome, "Touch-ups (up to 3.5 hours)", faixa(nome, "Touch-ups (up to 3.5 hours)"), touch);
  const room = site({ services: ["paint"], paint: { option: "rooms", rooms: 1 } }, "paint");
  conferir("faixa", nome, "A room, walls, two coats", faixa(nome, "A room, walls, two coats"), room);
  const mat = site({ services: ["paint"], paint: { option: "touchup", rooms: 1, materials: true } }, "paint");
  conferir("addon", nome, "Paint and materials pack", addon(nome, "Paint and materials pack"), { price: mat.price - touch.price, pay: mat.pay - touch.pay });
}

// Reparos: meia diária e diária.
for (const [pkg, label] of [["half", "Half day (up to 3.5 hours)"], ["day", "Full day (up to 7 hours)"]]) {
  const s = site({ services: ["fix"], fix: { package: pkg } }, "fix");
  conferir("faixa", P.FIX.osTitle, label, faixa(P.FIX.osTitle, label), s);
}

// Certificados: CP12 base, EICR e EPC por tamanho.
{
  const item = (id) => P.CERT.items.find((i) => i.id === id);
  const gas = site({ services: ["cert"], size: "2", cert: { items: ["gas"] } }, "cert", { certItem: item("gas") });
  conferir("faixa", item("gas").osTitle, "CP12, 1 appliance", faixa(item("gas").osTitle, "CP12, 1 appliance"), gas);
  const eicrLabel = { studio: "EICR studio (up to 8 circuits)", 1: "EICR 1 bed (up to 8 circuits)", 2: "EICR 2 bed (up to 8 circuits)", 3: "EICR 3 bed (up to 10 circuits)", 4: "EICR 4 bed (up to 12 circuits)" };
  for (const [size, label] of Object.entries(eicrLabel)) {
    const s = site({ services: ["cert"], size, cert: { items: ["eicr"] } }, "cert", { certItem: item("eicr") });
    conferir("faixa", item("eicr").osTitle, label, faixa(item("eicr").osTitle, label), s);
  }
  const epcLabel = { studio: "EPC studio", 1: "EPC 1 bed", 2: "EPC 2 bed", 3: "EPC 3 bed", 4: "EPC 4 bed", 5: "EPC 5+ bed" };
  for (const [size, label] of Object.entries(epcLabel)) {
    const s = site({ services: ["cert"], size, cert: { items: ["epc"] } }, "cert", { certItem: item("epc") });
    conferir("faixa", item("epc").osTitle, label, faixa(item("epc").osTitle, label), s);
  }
}

// Todo título que o site manda como service_type precisa ligar num serviço ativo do OS.
const titulos = new Set([...P.CLEAN.kinds.map((k) => k.osTitle), P.PAINT.osTitle, P.FIX.osTitle, ...P.CERT.items.map((i) => i.osTitle)]);
for (const t of titulos) {
  if (servico[t]) ok++;
  else { dif++; console.log(`FALTA  o site manda "${t}" e o OS não liga em nenhum serviço ativo`); }
}

// ─── 2. Do OS para o site ────────────────────────────────────────────────────

const soOs = [];
for (const r of rows) {
  const kind = Object.entries(KIND).find(([, n]) => servico[n]?.id === r.id)?.[0];
  for (const f of r.pricing_presets || []) {
    if (vistos.has(`faixa|${r.name}|${f.label}`)) continue;
    const m = f.label.match(/^(Studio|\d) ?(?:bed)? · (\d) bath$/i);
    if (kind && m) {
      // Faixa de limpeza com mais banheiros: o site monta pela escada e tem de dar o mesmo.
      const size = /studio/i.test(m[1]) ? "studio" : m[1];
      conferir("faixa", r.name, f.label, f, site({ services: ["clean"], size, bathrooms: Number(m[2]), clean: { kind } }, "clean"));
      continue;
    }
    soOs.push(`${r.name} · ${f.label} (£${f.fixed_price ?? "hora"}/£${f.partner_cost})`);
  }
}

console.log(`\n${ok} conferem · ${dif} faltam ou divergem`);
if (soOs.length) console.log(`Só no OS, o site não vende (${soOs.length}):\n  ${soOs.join("\n  ")}`);
process.exit(dif ? 1 : 0);
