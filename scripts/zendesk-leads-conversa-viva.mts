/**
 * A conversa ao vivo do Harvey na ⚡ Action Required (dono, 07/11/2026: "to sem acesso
 * nessas conversas e ta ruim").
 *
 * Antes (14/10): enquanto o Harvey atendia, a conversa "AI agent" tinha `lead_mirrored` e
 * `harvey_ai`, e as duas tags a escondiam da ⚡ Action Required. Ninguém via a conversa.
 *
 * Agora: quando o lead responde, o Harvey põe Action Required Yes na conversa (uma vez) e
 * tira `harvey_ai` (zendesk-wa.ts). Ela entra na ⚡ Action Required para acompanhar. Quem
 * não quer mais acompanhar põe Action Required No, e o gatilho abaixo devolve `harvey_ai`.
 *
 * Este script:
 *   1. ⚡ Action Required: tira a condição "not_includes lead_mirrored" (a `harvey_ai` segue).
 *   2. Gatilho "⚡ Harvey conversation: AR No hides it again": Action Required No numa
 *      conversa com `lead_mirrored` → volta `harvey_ai`.
 *   3. Tira `lead_mirrored` de ticket que já não é "AI agent" (tag esquecida).
 *   4. Com --marcar-atuais: Yes nas conversas ao vivo de agora (elas entram na view).
 *
 *   ENV_DIR=~/master-os npx tsx scripts/zendesk-leads-conversa-viva.mts                   ensaio
 *   ... --aplicar [--marcar-atuais]                                                         backup e aplica
 *   ... --desfazer <backup.json>                                                            volta a view e desliga o gatilho
 *
 * Backup em $BACKUP_DIR (padrão ~/fixfy-backups/zendesk), antes de qualquer escrita.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal(process.env.ENV_DIR || process.cwd());
const { zendeskApi } = await import("../src/lib/zendesk");
const { TAG_CONVERSA_ESPELHADA } = await import("../src/lib/um-ticket/flags");
const { ACTION_REQUIRED_FIELD_ID, ACTION_REQUIRED_YES, ACTION_REQUIRED_NO } = await import("../src/lib/fila-de-acao");

const VIEW_AR = Number(process.env.ZENDESK_VIEW_ACTION_REQUIRED?.trim() || "5685314898719");
const TRIGGER_TITULO = "⚡ Harvey conversation: AR No hides it again";

const APLICAR = process.argv.includes("--aplicar");
const MARCAR_ATUAIS = process.argv.includes("--marcar-atuais");
const iDesfazer = process.argv.indexOf("--desfazer");
const BACKUP_DIR = process.env.BACKUP_DIR || join(homedir(), "fixfy-backups", "zendesk");

type Cond = { field: string; operator?: string; value: unknown };
type View = { id: number; title: string; conditions: { all: Cond[]; any: Cond[] } };
type Trigger = { id: number; title: string; active: boolean };
type Ticket = { id: number; status: string; support_type?: string; subject: string; updated_at: string };

const linha = (c: Cond) => `${c.field} ${c.operator ?? ""} ${JSON.stringify(c.value)}`;
const ehMirrored = (c: Cond) => c.field === "current_tags" && c.operator === "not_includes" && c.value === TAG_CONVERSA_ESPELHADA;

async function triggerNosso(): Promise<Trigger | null> {
  const { triggers } = await zendeskApi<{ triggers: Trigger[] }>("triggers.json?per_page=100");
  return triggers.find((t) => t.title === TRIGGER_TITULO) ?? null;
}

if (iDesfazer >= 0) {
  const arq = process.argv[iDesfazer + 1];
  if (!arq) throw new Error("--desfazer precisa do arquivo de backup");
  const { ar } = JSON.parse(readFileSync(arq, "utf8")) as { ar: View };
  await zendeskApi(`views/${ar.id}.json`, { method: "PUT", body: { view: { all: ar.conditions.all, any: ar.conditions.any } } });
  console.log(`view ${ar.id} voltou`);
  const t = await triggerNosso();
  if (t?.active) {
    await zendeskApi(`triggers/${t.id}.json`, { method: "PUT", body: { trigger: { active: false } } });
    console.log(`gatilho ${t.id} desligado`);
  }
  process.exit(0);
}

// 1. ⚡ Action Required
const ar = (await zendeskApi<{ view: View }>(`views/${VIEW_AR}.json`)).view;
const arAll = ar.conditions.all.filter((c) => !ehMirrored(c));
console.log(`⚡ AR (${VIEW_AR}) "${ar.title}"`);
console.log("  ALL hoje:", ar.conditions.all.map(linha).join(" | "));
console.log("  ALL novo:", arAll.map(linha).join(" | "));

// 2. gatilho
const existente = await triggerNosso();
const trigger = {
  title: TRIGGER_TITULO,
  active: true,
  conditions: {
    all: [
      { field: `custom_fields_${ACTION_REQUIRED_FIELD_ID}`, operator: "is", value: ACTION_REQUIRED_NO },
      { field: "current_tags", operator: "includes", value: TAG_CONVERSA_ESPELHADA },
      { field: "current_tags", operator: "not_includes", value: "harvey_ai" },
      { field: "status", operator: "less_than", value: "solved" },
    ],
    any: [],
  },
  actions: [{ field: "current_tags", value: "harvey_ai" }],
};
console.log(`\nGatilho "${TRIGGER_TITULO}": ${existente ? `já existe (#${existente.id})` : "novo"}`);

// 3 e 4
const { results } = await zendeskApi<{ results: Ticket[] }>(
  `search.json?query=${encodeURIComponent(`type:ticket status<solved tags:${TAG_CONVERSA_ESPELHADA}`)}`,
);
const vivas = (results ?? []).filter((t) => t.support_type === "ai_agent");
const esquecidos = (results ?? []).filter((t) => t.support_type && t.support_type !== "ai_agent");
console.log(`\nConversas ao vivo do Harvey agora: ${vivas.length}`);
for (const t of vivas) console.log(`  #${t.id} ${t.updated_at.slice(0, 16)} ${t.subject.slice(0, 50)}`);
console.log(MARCAR_ATUAIS ? "  → ganham Yes e entram na ⚡ Action Required" : "  (sem --marcar-atuais ficam como estão; as próximas entram sozinhas)");
console.log(`Tag ${TAG_CONVERSA_ESPELHADA} esquecida (sai): ${esquecidos.map((t) => `#${t.id}`).join(", ") || "nenhum"}`);

if (!APLICAR) {
  console.log("\nEnsaio: nada mudou. Com --aplicar: backup e aplica.");
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const arq = join(BACKUP_DIR, `ar-conversa-viva-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(arq, JSON.stringify({ ar }, null, 1));
console.log("\nbackup:", arq);

await zendeskApi(`views/${VIEW_AR}.json`, { method: "PUT", body: { view: { all: arAll, any: ar.conditions.any } } });
console.log("⚡ AR atualizada");
if (existente) await zendeskApi(`triggers/${existente.id}.json`, { method: "PUT", body: { trigger } });
else await zendeskApi("triggers.json", { method: "POST", body: { trigger } });
console.log("gatilho gravado");
for (const t of esquecidos) {
  await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: [TAG_CONVERSA_ESPELHADA] } });
  console.log(`  #${t.id} sem ${TAG_CONVERSA_ESPELHADA}`);
}
if (MARCAR_ATUAIS) {
  for (const t of vivas) {
    await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { custom_fields: [{ id: ACTION_REQUIRED_FIELD_ID, value: ACTION_REQUIRED_YES }] } } });
    await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: ["harvey_ai"] } });
    console.log(`  #${t.id} Action Required Yes`);
  }
}
console.log(`\nDesfazer: ENV_DIR=~/master-os npx tsx scripts/zendesk-leads-conversa-viva.mts --desfazer ${arq}`);
