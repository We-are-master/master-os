/**
 * Alarmes dos portões do dono (dono, 10/11/2026): job Unassigned há mais de 2h sem
 * esperar sinal, Final Check há mais de 12h e parceiro que não começou 30 min depois do
 * horário ganham Action Required no ticket do job, uma vez cada. Regras em
 * src/lib/alarmes-portoes.ts.
 *
 *   ALARMES_PORTOES=1 npx tsx scripts/alarmes-portoes.mts            ensaio: lista
 *   ALARMES_PORTOES=1 npx tsx scripts/alarmes-portoes.mts --aplicar  marca no Zendesk
 *
 * Sem ALARMES_PORTOES=1 sai sem ler nada. Nunca muda job, nunca fala com cliente nem
 * parceiro. O fixfy-workers roda a cada 15 min (scripts/workers/rotinas.mts). A trava de
 * "já avisei" fica em .alarmes-portoes.json (FIXFY_STATE_DIR no Railway).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arquivoDeEstado } from "./lib/estado.mjs";

for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(new URL(`../${arq}`, import.meta.url), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const { alarmesLigados, lerEntradaDosAlarmes, passadaDosAlarmes } = await import("../src/lib/alarmes-portoes");
if (!alarmesLigados()) {
  console.log("ALARMES_PORTOES desligado: nada lido, nada marcado.");
  process.exit(0);
}
const { createServiceClient } = await import("../src/lib/supabase/service");
const { isZendeskConfigured } = await import("../src/lib/zendesk");
const { precisaDeAcao } = await import("../src/lib/fila-de-acao");

const aplicar = process.argv.includes("--aplicar");
if (aplicar && !isZendeskConfigured()) throw new Error("Zendesk não configurado: nada a marcar");
const ARQ = arquivoDeEstado(".alarmes-portoes.json");
let travas: Record<string, string> = {};
try {
  travas = JSON.parse(readFileSync(ARQ, "utf8")) as Record<string, string>;
} catch {} // primeira passada

const sb = createServiceClient();
const r = await passadaDosAlarmes({ ler: () => lerEntradaDosAlarmes(sb), marcar: (t, acao) => precisaDeAcao(t, acao), travas }, { aplicar });
if (r.feito === "desligado") process.exit(0);
if (aplicar) writeFileSync(ARQ, JSON.stringify(travas, null, 1));
const porPortao: Record<string, number> = {};
for (const a of r.alarmes) porPortao[a.portao] = (porPortao[a.portao] ?? 0) + 1;
console.log(
  `${aplicar ? "Aplicado" : "Ensaio"}: ${r.alarmes.length} alarmes (${Object.entries(porPortao).map(([p, n]) => `${p} ${n}`).join(", ") || "nenhum"}), ` +
    `${r.marcados} ${aplicar ? "marcados" : "marcariam"}, ${r.jaAvisados} já avisados, ${r.semTicket} sem ticket, ${r.adiados} adiados, ${r.falhas} falhas.`,
);
