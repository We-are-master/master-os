/**
 * A rede de segurança do Harvey (dono, 23/10/2026: "e se o Harvey não classificar, o lead some?").
 *
 * Conversa do WhatsApp com o cliente esperando (Reply Status 🔴) há mais de 20 min:
 * ganha UMA nota interna "Harvey didn't answer" e a tag `harvey_sem_resposta`. A view
 * ⚡ Action Required já mostra quem está esperando; a nota diz por quê, no ticket. Quando
 * o cliente é respondido, a tag sai e a próxima espera ganha nota de novo.
 *
 *   npx tsx scripts/harvey-rede-de-seguranca.mts            ensaio: lista
 *   npx tsx scripts/harvey-rede-de-seguranca.mts --aplicar  escreve
 *
 * Nunca fala com o cliente. O fixfy-workers roda a cada 10 min (scripts/workers/rotinas.mts).
 */
import { readFileSync } from "node:fs";

for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(new URL(`../${arq}`, import.meta.url), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const { zendeskApi } = await import("../src/lib/zendesk");
const { conversasParadas, esperaDeVerdade, tempo } = await import("../src/lib/harvey-wa/painel");
const { createServiceClient } = await import("../src/lib/supabase/service");
const sb = createServiceClient();

const aplicar = process.argv.includes("--aplicar");
const TAG = "harvey_sem_resposta";
const RS = Number(process.env.ZENDESK_REPLY_STATUS_FIELD_ID?.trim() || "5698641403423");
type T = { id: number; subject: string | null; updated_at: string; tags: string[]; requester_id?: number | null; custom_fields?: Array<{ id: number; value: unknown }> };
const buscar = async (q: string) => (await zendeskApi<{ results?: T[] }>(`search.json?query=${encodeURIComponent(q)}&per_page=100`)).results ?? [];

const agora = new Date();
const esperando = conversasParadas(await buscar(`type:ticket status<solved tags:harvey_wa custom_field_${RS}:reply_awaiting`), agora);
let anotados = 0;
for (const c of esperando) {
  const t = (await zendeskApi<{ ticket: T }>(`tickets/${c.ticketId}.json`)).ticket;
  if (t.tags.includes(TAG)) continue;
  // Com o Harvey, a conversa diz quem falou por último; o ticket não sabe (#51653).
  if (c.comHarvey) {
    const tel = t.requester_id ? (await zendeskApi<{ user?: { phone?: string | null } }>(`users/${t.requester_id}.json`).catch(() => ({ user: undefined }))).user?.phone ?? null : null;
    const { data: conv } = tel
      ? await sb.from("harvey_wa_conversas").select("cliente_em, harvey_em").eq("phone", tel).order("atualizado_em", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const espera = esperaDeVerdade(conv as { cliente_em: string | null; harvey_em: string | null } | null, c.minutos, agora);
    if (espera == null) {
      console.log(`#${c.ticketId} ${c.assunto}: Harvey already answered, no note`);
      continue;
    }
    c.minutos = espera;
  }
  const quem = c.comHarvey ? "Harvey didn't answer" : "No one from the team has answered";
  console.log(`#${c.ticketId} ${c.assunto}: ${quem}, waiting ${tempo(c.minutos)}`);
  if (!aplicar) continue;
  await zendeskApi(`tickets/${c.ticketId}.json`, {
    method: "PUT",
    body: { ticket: { comment: { public: false, body: `⏱ ${quem}: the customer has been waiting ${tempo(c.minutos)} on WhatsApp. Reply here or hand it to the team.` } } },
  });
  await zendeskApi(`tickets/${c.ticketId}/tags.json`, { method: "PUT", body: { tags: [TAG] } });
  anotados++;
}

// Respondido: a tag sai, para a próxima espera ganhar nota.
let soltos = 0;
for (const t of await buscar(`type:ticket tags:${TAG}`)) {
  const aindaEspera = t.custom_fields?.find((f) => Number(f.id) === RS)?.value === "reply_awaiting";
  if (aindaEspera) continue;
  if (aplicar) await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: [TAG] } });
  soltos++;
}
console.log(`${aplicar ? "Aplicado" : "Ensaio"}: ${esperando.length} esperando >20 min, ${anotados} anotados agora, ${soltos} já respondidos (tag ${aplicar ? "tirada" : "sairia"}).`);
