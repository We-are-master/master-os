/**
 * 🎯 Leads mostra a CONVERSA AO VIVO do WhatsApp (dono, 07/11/2026: "to sem acesso
 * nessas conversas e ta ruim").
 *
 * Antes (14/10): enquanto o Harvey atendia, a conversa "AI agent" ganhava `lead_mirrored`
 * e sumia da 🎯 Leads e do ⚡ Action Required; ficava o ticket do lead, com notas. Ninguém
 * via a conversa.
 *
 * Agora:
 *   1. 🎯 Leads: mostra Lead / To Call OU a conversa com `lead_mirrored`; esconde o
 *      ticket do lead com `harvey_handling` (ele entra na conversa pelo merge).
 *   2. ⚡ Action Required: ticket em 🎯 Lead não entra sozinho quando o cliente responde.
 *      Para mandar ao AR, a pessoa muda o status (Open) à mão.
 *   3. Trigger "🎯 Lead: customer replied, stays in Lead": cliente respondeu num ticket
 *      que estava em 🎯 Lead → volta a 🎯 Lead (o Zendesk reabre para Open sozinho).
 *      Quem a equipe pôs em Open à mão não volta.
 *   4. Tira `lead_mirrored` de ticket que não é mais "AI agent" (tag esquecida).
 *
 *   ENV_DIR=~/master-os npx tsx scripts/zendesk-leads-conversa-viva.mts               ensaio: diff, nada muda
 *   ... --aplicar                                                                       backup e aplica
 *   ... --desfazer <backup.json>                                                        volta views e desliga o trigger
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

const VIEW_LEADS = Number(process.env.ZENDESK_VIEW_LEADS?.trim() || "6394828790303");
const VIEW_AR = Number(process.env.ZENDESK_VIEW_ACTION_REQUIRED?.trim() || "5685314898719");
const ST_LEAD = "6417913706527";
const ST_TO_CALL = "6417870637599";
const TRIGGER_TITULO = "🎯 Lead: customer replied, stays in Lead";

const APLICAR = process.argv.includes("--aplicar");
const iDesfazer = process.argv.indexOf("--desfazer");
const BACKUP_DIR = process.env.BACKUP_DIR || join(homedir(), "fixfy-backups", "zendesk");

type Cond = { field: string; operator?: string; value: unknown };
type View = { id: number; title: string; conditions: { all: Cond[]; any: Cond[] } };
type Trigger = { id: number; title: string; active: boolean };

const linha = (c: Cond) => `${c.field} ${c.operator ?? ""} ${JSON.stringify(c.value)}`;
const ehMirrored = (c: Cond) => c.field === "current_tags" && c.value === TAG_CONVERSA_ESPELHADA;

async function view(id: number): Promise<View> {
  return (await zendeskApi<{ view: View }>(`views/${id}.json`)).view;
}

async function triggerNosso(): Promise<Trigger | null> {
  const { triggers } = await zendeskApi<{ triggers: Trigger[] }>("triggers.json?per_page=100");
  return triggers.find((t) => t.title === TRIGGER_TITULO) ?? null;
}

if (iDesfazer >= 0) {
  const arq = process.argv[iDesfazer + 1];
  if (!arq) throw new Error("--desfazer precisa do arquivo de backup");
  const b = JSON.parse(readFileSync(arq, "utf8")) as { leads: View; ar: View };
  for (const v of [b.leads, b.ar]) {
    await zendeskApi(`views/${v.id}.json`, { method: "PUT", body: { view: { all: v.conditions.all, any: v.conditions.any } } });
    console.log(`view ${v.id} voltou`);
  }
  const t = await triggerNosso();
  if (t?.active) {
    await zendeskApi(`triggers/${t.id}.json`, { method: "PUT", body: { trigger: { active: false } } });
    console.log(`trigger ${t.id} desligado`);
  }
  process.exit(0);
}

// 1. 🎯 Leads
const leads = await view(VIEW_LEADS);
const leadsAll: Cond[] = [
  { field: "status", operator: "less_than", value: "solved" },
  { field: "current_tags", operator: "not_includes", value: "harvey_handling" },
];
const leadsAny: Cond[] = [
  { field: "custom_status_id", operator: "includes", value: [ST_LEAD, ST_TO_CALL] },
  { field: "current_tags", operator: "includes", value: TAG_CONVERSA_ESPELHADA },
];

// 2. ⚡ Action Required: tira o "esconde lead_mirrored" (conversa ao vivo não é AR por si: ela
// é New, que está no any, mas harvey_ai continua escondendo) e não deixa 🎯 Lead entrar sozinho.
const ar = await view(VIEW_AR);
const arAll: Cond[] = [
  ...ar.conditions.all.filter((c) => !ehMirrored(c) && !(c.field === "custom_status_id" && c.operator === "not_includes")),
  { field: "custom_status_id", operator: "not_includes", value: [ST_LEAD] },
];

console.log(`🎯 Leads (${VIEW_LEADS}) "${leads.title}"`);
console.log("  ALL hoje:", leads.conditions.all.map(linha).join(" | "));
console.log("  ANY hoje:", leads.conditions.any.map(linha).join(" | ") || "-");
console.log("  ALL novo:", leadsAll.map(linha).join(" | "));
console.log("  ANY novo:", leadsAny.map(linha).join(" | "));
console.log(`\n⚡ AR (${VIEW_AR}) "${ar.title}"`);
console.log("  ALL hoje:", ar.conditions.all.map(linha).join(" | "));
console.log("  ALL novo:", arAll.map(linha).join(" | "));
console.log("  ANY fica:", ar.conditions.any.map(linha).join(" | "));

// 3. trigger
const existente = await triggerNosso();
const trigger = {
  title: TRIGGER_TITULO,
  active: true,
  conditions: {
    all: [
      { field: "role", operator: "is", value: "end_user" },
      { field: "status", operator: "less_than", value: "solved" },
      { field: "current_tags", operator: "not_includes", value: "lead_moved_on" },
      // Só quem ESTAVA em 🎯 Lead: quem a equipe pôs em Open à mão (AR manual) fica em Open.
      { field: "custom_status_id", operator: "value_previous", value: ST_LEAD },
    ],
    any: [
      { field: "current_tags", operator: "includes", value: "harvey_wa_lead" },
      { field: "current_tags", operator: "includes", value: "lead_checkatrade" },
      { field: "current_tags", operator: "includes", value: "lead_meta" },
      { field: "current_tags", operator: "includes", value: "lead_gen" },
    ],
  },
  actions: [{ field: "custom_status_id", value: ST_LEAD }],
};
console.log(`\nTrigger "${TRIGGER_TITULO}": ${existente ? `já existe (#${existente.id}, ${existente.active ? "ativo" : "inativo"})` : "novo"}`);

// 4. lead_mirrored esquecido
const { results } = await zendeskApi<{ results: Array<{ id: number; support_type?: string; status: string }> }>(
  `search.json?query=${encodeURIComponent(`type:ticket status<solved tags:${TAG_CONVERSA_ESPELHADA}`)}`,
);
const esquecidos = (results ?? []).filter((t) => t.support_type && t.support_type !== "ai_agent");
console.log(`\nConversas ao vivo com ${TAG_CONVERSA_ESPELHADA} (passam a aparecer na 🎯 Leads): ${(results ?? []).length - esquecidos.length}`);
console.log(`Tag esquecida em ticket que já não é AI agent (sai): ${esquecidos.map((t) => `#${t.id}`).join(", ") || "nenhum"}`);

if (!APLICAR) {
  console.log("\nEnsaio: nada mudou. Com --aplicar: backup e aplica.");
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const arq = join(BACKUP_DIR, `leads-conversa-viva-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(arq, JSON.stringify({ leads, ar }, null, 1));
console.log("\nbackup:", arq);

await zendeskApi(`views/${VIEW_LEADS}.json`, { method: "PUT", body: { view: { all: leadsAll, any: leadsAny } } });
console.log("🎯 Leads atualizada");
await zendeskApi(`views/${VIEW_AR}.json`, { method: "PUT", body: { view: { all: arAll, any: ar.conditions.any } } });
console.log("⚡ AR atualizada");
if (existente) await zendeskApi(`triggers/${existente.id}.json`, { method: "PUT", body: { trigger } });
else await zendeskApi("triggers.json", { method: "POST", body: { trigger } });
console.log("trigger gravado");
for (const t of esquecidos) {
  await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: [TAG_CONVERSA_ESPELHADA] } });
  console.log(`  #${t.id} sem ${TAG_CONVERSA_ESPELHADA}`);
}
console.log(`\nDesfazer: ENV_DIR=~/master-os npx tsx scripts/zendesk-leads-conversa-viva.mts --desfazer ${arq}`);
