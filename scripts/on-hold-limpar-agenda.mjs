#!/usr/bin/env node
/**
 * Backfill único: job em On Hold não segura data.
 *
 * A regra nova (18/08/2026) limpa a agenda ao entrar em hold — snapshot fica,
 * data viva sai. Este script aplica a mesma regra nos jobs que JÁ estavam em
 * hold antes da mudança e por isso continuam ocupando calendário e seleção de
 * datas.
 *
 * Só toca jobs com status on_hold E alguma data viva. O snapshot existente
 * nunca é sobrescrito: onde já há snapshot, a data viva só é apagada; onde não
 * há, a data viva vira o snapshot antes de sair.
 *
 *   node scripts/on-hold-limpar-agenda.mjs             # relatório, não muda nada
 *   node scripts/on-hold-limpar-agenda.mjs --aplicar   # aplica
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
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = {
  apikey: env.SERVICE_ROLE_KEY,
  authorization: "Bearer " + env.SERVICE_ROLE_KEY,
  "content-type": "application/json",
};

const CAMPOS = ["scheduled_date", "scheduled_start_at", "scheduled_end_at", "scheduled_finish_date"];
const SNAP = Object.fromEntries(CAMPOS.map((c) => [c, "on_hold_snapshot_" + c]));

async function main() {
  const sel = ["id", "reference", "title", "status", ...CAMPOS, ...Object.values(SNAP)].join(",");
  const filtroVivo = CAMPOS.map((c) => `${c}.not.is.null`).join(",");
  const jobs = await (await fetch(
    `${SB}/rest/v1/jobs?select=${sel}&status=eq.on_hold&or=(${encodeURIComponent(filtroVivo)})`,
    { headers: SH },
  )).json();

  if (!Array.isArray(jobs)) {
    console.error("Busca falhou:", jobs);
    process.exit(1);
  }
  if (jobs.length === 0) {
    console.log("Nenhum job em On Hold com data viva. Nada a fazer.");
    return;
  }

  console.log(`${jobs.length} job(s) em On Hold ainda com data viva:\n`);
  for (const j of jobs) {
    const patch = {};
    for (const c of CAMPOS) {
      if (j[c] == null) continue;
      if (j[SNAP[c]] == null) patch[SNAP[c]] = j[c];
      patch[c] = null;
    }
    const snapNovo = Object.keys(patch).filter((k) => k.startsWith("on_hold_snapshot_")).length;
    console.log(
      `  ${j.reference}  ${String(j.title ?? "").slice(0, 40)}\n` +
      `    data viva: ${j.scheduled_date ?? j.scheduled_start_at ?? "?"}` +
      (snapNovo ? `  (vira snapshot: ${snapNovo} campo(s))` : "  (snapshot ja existia)"),
    );
    if (!APLICAR) continue;
    const r = await fetch(`${SB}/rest/v1/jobs?id=eq.${j.id}`, {
      method: "PATCH",
      headers: { ...SH, prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      console.error(`    FALHOU: ${r.status} ${await r.text()}`);
      continue;
    }
    await fetch(`${SB}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { ...SH, prefer: "return=minimal" },
      body: JSON.stringify([{
        entity_type: "job",
        entity_id: j.id,
        entity_ref: j.reference,
        action: "updated",
        field_name: "scheduled_date",
        old_value: j.scheduled_date ?? j.scheduled_start_at ?? null,
        new_value: null,
        metadata: { source: "backfill_on_hold_limpar_agenda" },
      }]),
    }).catch(() => {});
    console.log("    limpo.");
  }
  if (!APLICAR) console.log("\nRelatório apenas. Rode com --aplicar para limpar.");
}

main().catch((e) => { console.error(e); process.exit(1); });
