/**
 * View 🎯 Leads com UMA linha por cliente enquanto o Harvey atende (dono, 14/10/2026).
 *
 * Hoje o cliente do Checkatrade aparece duas vezes: o ticket do lead (com a ficha,
 * tag harvey_handling) e a conversa do WhatsApp "AI agent" (que herdou as tags
 * harvey_wa_lead e lead_checkatrade). Com ONE_TICKET_LEADS_VIEW_ON=1 o Harvey põe
 * `lead_mirrored` na conversa enquanto o lead espelha, e tira na passagem (quando o
 * lead entra nela pelo merge). Este script muda a VIEW para esconder essa tag e marca
 * as conversas que já estão duplicadas agora.
 *
 *   ENV_DIR=~/master-os npx tsx scripts/zendesk-view-leads-uma-linha.mts              ensaio: diff + duplicados
 *   ... --aplicar                                                                      backup, muda a view, marca
 *   ... --desfazer <backup.json>                                                       volta as condições do backup
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

const VIEW = Number(process.env.ZENDESK_VIEW_LEADS?.trim() || "6394828790303");
const APLICAR = process.argv.includes("--aplicar");
const iDesfazer = process.argv.indexOf("--desfazer");
const BACKUP_DIR = process.env.BACKUP_DIR || join(homedir(), "fixfy-backups", "zendesk");

type Cond = { field: string; operator: string; value: unknown };
type View = { id: number; title: string; conditions: { all: Cond[]; any: Cond[] } };
type Ticket = { id: number; status: string; subject: string; requester_id: number; tags: string[]; support_type?: string; via?: { channel?: string } };

const CONDICAO: Cond = { field: "current_tags", operator: "not_includes", value: TAG_CONVERSA_ESPELHADA };

function backup(v: View): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const arq = join(BACKUP_DIR, `view-${VIEW}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(arq, JSON.stringify(v, null, 1));
  return arq;
}

const linha = (c: Cond) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`;

if (iDesfazer >= 0) {
  const arq = process.argv[iDesfazer + 1];
  if (!arq) throw new Error("--desfazer precisa do arquivo de backup");
  const antes = JSON.parse(readFileSync(arq, "utf8")) as View;
  const atual = (await zendeskApi<{ view: View }>(`views/${VIEW}.json`)).view;
  console.log("backup do estado atual:", backup(atual));
  await zendeskApi(`views/${VIEW}.json`, { method: "PUT", body: { view: { all: antes.conditions.all, any: antes.conditions.any } } });
  console.log(`view ${VIEW} voltou às condições de ${arq}`);
  process.exit(0);
}

const v = (await zendeskApi<{ view: View }>(`views/${VIEW}.json`)).view;
const jaTem = v.conditions.all.some((c) => c.field === CONDICAO.field && c.operator === CONDICAO.operator && c.value === CONDICAO.value);
console.log(`View ${VIEW} "${v.title}"`);
console.log("ALL hoje:");
for (const c of v.conditions.all) console.log(`    ${linha(c)}`);
console.log(jaTem ? "\n(a condição já está na view)" : `\nDiff:\n  + ${linha(CONDICAO)}`);

// Os duplicados de agora: na view, conversa "AI agent" do WhatsApp + lead aberto do mesmo cliente.
const naView: Ticket[] = [];
for (let pagina = 1; pagina <= 5; pagina++) {
  const r = await zendeskApi<{ tickets: Ticket[]; next_page: string | null }>(`views/${VIEW}/tickets.json?per_page=100&page=${pagina}`);
  naView.push(...(r.tickets ?? []));
  if (!r.next_page) break;
}
const porPessoa = new Map<number, Ticket[]>();
for (const t of naView) porPessoa.set(t.requester_id, [...(porPessoa.get(t.requester_id) ?? []), t]);
const marcar: Array<{ conversa: Ticket; lead: Ticket }> = [];
for (const ts of porPessoa.values()) {
  const lead = ts.find((t) => t.tags.includes("harvey_handling") && t.via?.channel !== "whatsapp");
  if (!lead) continue;
  for (const conversa of ts.filter((t) => t.id !== lead.id && t.via?.channel === "whatsapp" && !t.tags.includes(TAG_CONVERSA_ESPELHADA))) marcar.push({ conversa, lead });
}
// A busca pela pessoa pega o par quando a conversa entrou e o lead não (ou o contrário): conta só o que está na view.
console.log(`\nNa view agora: ${naView.length} tickets de ${porPessoa.size} pessoas.`);
console.log(`Clientes com lead + conversa na view (linhas que somem): ${marcar.length}`);
for (const { conversa, lead } of marcar) {
  const tipo = conversa.support_type ?? (await zendeskApi<{ ticket: Ticket }>(`tickets/${conversa.id}.json`)).ticket.support_type;
  console.log(`  lead #${lead.id} "${lead.subject.slice(0, 50)}"  +  conversa #${conversa.id} (${tipo ?? "?"}) "${conversa.subject.slice(0, 40)}"`);
}

if (!APLICAR) {
  console.log("\nEnsaio: nada mudou. Com --aplicar: backup, condição na view e tag nessas conversas.");
  process.exit(0);
}

console.log("\nbackup:", backup(v));
if (!jaTem) {
  await zendeskApi(`views/${VIEW}.json`, { method: "PUT", body: { view: { all: [...v.conditions.all, CONDICAO], any: v.conditions.any } } });
  console.log("view atualizada");
}
for (const { conversa } of marcar) {
  // PUT acrescenta (POST substituiria as tags).
  await zendeskApi(`tickets/${conversa.id}/tags.json`, { method: "PUT", body: { tags: [TAG_CONVERSA_ESPELHADA] } });
  console.log(`  #${conversa.id} marcado`);
}
console.log("Lembrete: ligar ONE_TICKET_LEADS_VIEW_ON=1 onde o Harvey roda (Railway), senão os próximos não são marcados.");
