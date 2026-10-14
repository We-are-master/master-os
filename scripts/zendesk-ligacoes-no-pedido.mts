/**
 * Ligação visível no ticket do pedido (dono, 14/10/2026). Cada ligação do Zendesk
 * Talk vira um ticket "Call with ..." resolvido sozinho, e a equipe não vê a
 * ligação no ticket do cliente. Este script põe uma NOTA INTERNA com o link da
 * ligação no ticket aberto do mesmo cliente. Não junta: a gravação mora no da ligação.
 *
 *   ENV_DIR=~/master-os npx tsx scripts/zendesk-ligacoes-no-pedido.mts [--dias 14]      ensaio
 *   ... --aplicar                                    grava (exige ONE_TICKET_CALL_NOTE_ON=1)
 *
 * Idempotente: a tag call_<id> vai no MESMO PUT da nota, no ticket aberto.
 * Para rodar sozinho, um launchd a cada 15 min com --dias 1 basta.
 */
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal(process.env.ENV_DIR || process.cwd());
const { zendeskApi, updateTicket } = await import("../src/lib/zendesk");
const { umTicketLigacao } = await import("../src/lib/um-ticket/flags");
const { ligacoesParaAnotar, tagDaLigacao, textoDaNotaDeLigacao } = await import("../src/lib/um-ticket/ligacao");

const APLICAR = process.argv.includes("--aplicar");
const iDias = process.argv.indexOf("--dias");
const DIAS = iDias >= 0 ? Number(process.argv[iDias + 1]) : 14;
if (APLICAR && !umTicketLigacao()) {
  console.log("ONE_TICKET_CALL_NOTE_ON não está ligado: nada é gravado.");
  process.exit(0);
}

type T = { id: number; status: string; subject: string; requester_id: number; created_at: string; updated_at: string; tags: string[]; via?: { channel?: string } };
const desde = new Date(Date.now() - DIAS * 86400_000).toISOString().slice(0, 10);
const todos: T[] = [];
let url: string | null = `search/export.json?query=${encodeURIComponent(`type:ticket created>=${desde}`)}&filter[type]=ticket&page[size]=100`;
while (url) {
  const r: { results: T[]; meta?: { has_more?: boolean }; links?: { next?: string } } = await zendeskApi(url);
  todos.push(...(r.results ?? []));
  url = r.meta?.has_more && r.links?.next ? r.links.next.replace(/^.*\/api\/v2\//, "") : null;
}
const ligacoes = todos.filter((t) => t.via?.channel === "voice");
const pessoas = [...new Set(ligacoes.map((t) => t.requester_id))];
const abertos: T[] = [];
for (const id of pessoas) {
  // Quem liga costuma ser outro usuário do Zendesk (só o telefone) que o do WhatsApp
  // ou do e-mail: junta os tickets de todo usuário com o mesmo telefone, como se fossem dele.
  const { user } = await zendeskApi<{ user: { phone: string | null } }>(`users/${id}.json`);
  const outros = user?.phone && user.phone.replace(/\D/g, "").length >= 10
    ? ((await zendeskApi<{ users: Array<{ id: number; role: string }> }>(`users/search.json?query=${encodeURIComponent(user.phone)}`)).users ?? []).filter((u) => u.role === "end-user").map((u) => u.id)
    : [];
  for (const uid of [...new Set([id, ...outros])].slice(0, 4)) {
    const r = await zendeskApi<{ tickets: T[] }>(`users/${uid}/tickets/requested.json?sort_by=updated_at&sort_order=desc&per_page=25`);
    abertos.push(...(r.tickets ?? []).map((t) => ({ ...t, requester_id: id })));
  }
}
const notas = ligacoesParaAnotar(
  ligacoes.map((t) => ({ id: t.id, requesterId: t.requester_id, criadoEm: t.created_at, assunto: t.subject, canal: t.via?.channel ?? null, tags: t.tags })),
  abertos.map((t) => ({ id: t.id, requesterId: t.requester_id, status: t.status, canal: t.via?.channel ?? null, atualizadoEm: t.updated_at, tags: t.tags })),
);
console.log(`${DIAS} dias: ${ligacoes.length} tickets de ligação, de ${pessoas.length} números.`);
console.log(`Ligações de quem tem ticket aberto (viram nota no pedido): ${notas.length}`);
const sub = process.env.ZENDESK_SUBDOMAIN?.trim() ?? "fixfy";
for (const n of notas) {
  console.log(`  #${n.ligacao.id} "${n.ligacao.assunto.slice(0, 40)}"  →  nota em #${n.alvo}`);
  if (!APLICAR) continue;
  await updateTicket({ ticketId: n.alvo, commentBody: textoDaNotaDeLigacao(n.ligacao, sub), publicComment: false, additionalTags: [tagDaLigacao(n.ligacao.id)] });
}
if (!APLICAR) console.log("\nEnsaio: nada gravado. Com --aplicar (e ONE_TICKET_CALL_NOTE_ON=1) as notas entram.");
