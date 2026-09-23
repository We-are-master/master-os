#!/usr/bin/env node
/**
 * Confere se o site B2C e o catálogo do OS cobram e pagam o mesmo, faixa por
 * faixa. O site não consulta o OS na hora de criar o job: ele manda o preço e
 * o repasse que calcula sozinho (pricing.js e server/b2c/partner-pay.js), e o
 * OS tem as mesmas faixas gravadas no service_catalog. Os dois lados precisam
 * bater, senão o job nasce com um valor e a tela do OS mostra outro.
 *
 * Lê o site de um checkout local do master-website, vizinho deste repo, ou do
 * caminho em MASTER_WEBSITE_DIR. Só lê: nada é gravado em lugar nenhum.
 *
 *   node scripts/catalogo/conferir-site-os.mjs
 *
 * Sai com código 1 se alguma faixa divergir, para dar para usar em CI.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "../load-env-local.mjs";

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
  .select("name,pricing_presets,pricing_addons")
  .eq("is_active", true);
if (error) throw error;

/** O que o site cobra e paga num cenário. */
function site(sel, service, extra = {}) {
  const p = P.priceSelection(sel);
  const lines = p.lines.filter((l) => l.service === service);
  return {
    price: lines.reduce((s, l) => s + (l.amount || 0), 0),
    pay: partnerPayFor({ service, lines, size: p.selection.size, kind: p.selection.clean?.kind, bathrooms: p.selection.bathrooms, ...extra }),
  };
}

/** Traduz a faixa do OS para o cenário do site; null quando o site não vende aquela faixa. */
function doSite(servico, label) {
  const m = label.match(/(Studio|\d)\s*(?:bed)?.*?(\d)\s*bath/i);
  if (servico.includes("Clean") && m) {
    const kind = servico.startsWith("End") ? "eot" : servico.startsWith("Deep") ? "deep" : "after";
    return site({ services: ["clean"], size: /studio/i.test(m[1]) ? "studio" : m[1], bathrooms: Number(m[2]), clean: { kind } }, "clean");
  }
  if (servico === "General Maintenance") {
    if (/^hourly/i.test(label)) return null; // o site vende só meia diária e diária
    return site({ services: ["fix"], fix: { package: /half/i.test(label) ? "half" : "day" } }, "fix");
  }
  if (servico === "Painter") {
    if (/full day/i.test(label)) return null; // o site vende touch-up e cômodo
    return site({ services: ["paint"], paint: { option: /room/i.test(label) ? "rooms" : "touchup", rooms: 1 } }, "paint");
  }
  const cert = { "Gas Safety Certificate": "gas", "Electrical Safety Report": "eicr", "Energy Performance Certificate": "epc" }[servico];
  if (cert) {
    if (cert === "gas" && !/1 appliance/i.test(label)) return null; // o site vende o CP12 base
    if (cert === "eicr" && /5-6/.test(label)) return null; // no EICR o 5+ é sob consulta
    const tam = /studio/i.test(label) ? "studio" : (label.match(/(\d)\+?\s*bed/i) || [])[1] || "2";
    const item = P.CERT.items.find((i) => i.id === cert);
    return site({ services: ["cert"], size: cert === "gas" ? "2" : tam, cert: { items: [cert] } }, "cert", { certItem: item });
  }
  return null;
}

let ok = 0;
let dif = 0;
let soOs = 0;
for (const r of rows) {
  for (const f of r.pricing_presets || []) {
    const s = doSite(r.name, f.label);
    if (!s) { soOs++; continue; }
    if (s.price === f.fixed_price && s.pay === f.partner_cost) { ok++; continue; }
    dif++;
    console.log(`DIF  ${r.name} · ${f.label}: OS £${f.fixed_price}/£${f.partner_cost}, site £${s.price}/£${s.pay}`);
  }
}

// Add-ons de limpeza que o site vende, contra o add-on do end of tenancy.
const eot = rows.find((r) => r.name === "End of Tenancy Clean");
const addon = Object.fromEntries((eot?.pricing_addons || []).map((a) => [a.label, a]));
const nomes = { carpet: "Carpet steam clean (per room)", fridge: "Fridge freezer", windows: "Windows outside", balcony: "Balcony, terrace or patio" };
for (const e of P.CLEAN.extras) {
  const a = addon[nomes[e.id]];
  if (a && a.fixed_price === e.price) ok++;
  else { dif++; console.log(`DIF  add-on ${e.label}: OS £${a?.fixed_price ?? "-"}, site £${e.price}`); }
}
P.CLEAN.extraBathroomSteps.forEach((preco, i) => {
  const a = addon[`Extra bathroom, ${["2nd", "3rd", "4th"][i]}`];
  if (a && a.fixed_price === preco) ok++;
  else { dif++; console.log(`DIF  banheiro extra ${i + 2}º: OS £${a?.fixed_price ?? "-"}, site £${preco}`); }
});

// Todo título que o site manda como service_type precisa existir ativo no OS.
const titulos = new Set([...P.CLEAN.kinds.map((k) => k.osTitle), P.PAINT.osTitle, P.FIX.osTitle, ...P.CERT.items.map((i) => i.osTitle)]);
for (const t of titulos) {
  if (rows.some((r) => r.name === t)) ok++;
  else { dif++; console.log(`FALTA  o site manda "${t}" e não existe serviço ativo com esse nome`); }
}

console.log(`${ok} conferem · ${dif} divergem · ${soOs} faixas só do OS`);
process.exit(dif ? 1 : 0);
