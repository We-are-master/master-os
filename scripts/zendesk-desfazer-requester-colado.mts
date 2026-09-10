/**
 * Desfaz o usuário do Zendesk que colou vários clientes num registro só.
 *
 * Causa (consertada em `zendesk-lifecycle.ts`): o `entityId` do requester era o
 * id da CONTA, então todo cliente da mesma organização gerava o mesmo
 * `external_id` e o `create_or_update` do Zendesk devolvia sempre o mesmo
 * end-user, grudando o e-mail novo como identidade e sobrescrevendo o nome.
 *
 * Este script repara o que já aconteceu: para cada ticket preso no usuário
 * compartilhado, solta o e-mail daquele cliente e reaponta o ticket para um
 * usuário próprio, com o `external_id` certo.
 *
 *   npx tsx scripts/zendesk-desfazer-requester-colado.mts            (ensaio)
 *   npx tsx scripts/zendesk-desfazer-requester-colado.mts --aplicar
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const APLICAR = process.argv.includes("--aplicar");
const UID = Number(process.argv.find((a) => /^\d{6,}$/.test(a)) ?? 6227834019359);

const { createServiceClient } = await import("../src/lib/supabase/service");
const { setTicketRequester } = await import("../src/lib/zendesk");
const sb = createServiceClient();
const sub = process.env.ZENDESK_SUBDOMAIN, em = process.env.ZENDESK_EMAIL, tk = process.env.ZENDESK_API_TOKEN;
const auth = `Basic ${Buffer.from(`${em}/token:${tk}`).toString("base64")}`;
const api = async (u: string, init?: RequestInit) =>
  fetch(`https://${sub}.zendesk.com/api/v2${u}`, { ...init, headers: { Authorization: auth, "content-type": "application/json", ...(init?.headers ?? {}) } });
const g = async (u: string) => (await api(u)).json() as any;

const usuario = (await g(`/users/${UID}.json`)).user;
console.log(`usuário ${UID}: "${usuario.name}" <${usuario.email}>`);
const identidades = (await g(`/users/${UID}/identities.json`)).identities ?? [];
const principal = String(usuario.email).toLowerCase();

const tickets = ((await g(`/search.json?query=${encodeURIComponent(`type:ticket requester:${UID}`)}`)).results ?? []) as any[];
console.log(`${identidades.length} identidades · ${tickets.length} tickets\n`);

// Qual cliente é dono de cada e-mail, e sob que organização.
const emails = identidades.map((i: any) => String(i.value).toLowerCase());
const { data: clientes } = await sb.from("clients").select("id,full_name,email,source_account_id").in("email", emails);
const porEmail = new Map((clientes ?? []).map((c: any) => [String(c.email).toLowerCase(), c]));

/** O e-mail do dono de um ticket sai do JOB, não do usuário colado. */
async function donoDoTicket(t: any): Promise<{ email: string; nome: string; clientId: string; orgId?: string } | null> {
  const ref = String(t.subject ?? "").match(/\bJOB-\d{3,}/i)?.[0];
  let clientId: string | null = null;
  if (ref) {
    const { data: j } = await sb.from("jobs").select("client_id").ilike("reference", ref).maybeSingle();
    clientId = (j as any)?.client_id ?? null;
  }
  if (!clientId) return null;
  const { data: c } = await sb.from("clients").select("id,full_name,email,source_account_id").eq("id", clientId).maybeSingle();
  const cli = c as any;
  if (!cli?.email?.includes("@")) return null;
  let orgId: string | undefined;
  if (cli.source_account_id) {
    const { data: a } = await sb.from("accounts").select("zendesk_organization_id").eq("id", cli.source_account_id).maybeSingle();
    orgId = (a as any)?.zendesk_organization_id ?? undefined;
  }
  return { email: String(cli.email), nome: String(cli.full_name ?? ""), clientId: cli.id, orgId };
}

let ok = 0, pulados = 0;
for (const t of tickets) {
  const dono = await donoDoTicket(t);
  if (!dono) { console.log(`  ✖ #${t.id} — não consegui provar o dono pelo JOB do assunto. Deixado como está.`); pulados++; continue; }
  const mesmo = dono.email.toLowerCase() === principal;
  console.log(`  ${mesmo ? "=" : "→"} #${t.id} ${String(t.subject).slice(0, 52)}`);
  console.log(`      dono: ${dono.nome} <${dono.email}>${mesmo ? "  (é o primário, fica)" : ""}`);
  if (mesmo || !APLICAR) { if (mesmo) pulados++; continue; }

  // 1) solta o e-mail do usuário colado, senão o Zendesk recusa criar o novo
  const ident = identidades.find((i: any) => String(i.value).toLowerCase() === dono.email.toLowerCase());
  if (ident) {
    const del = await api(`/users/${UID}/identities/${ident.id}.json`, { method: "DELETE" });
    if (!del.ok) { console.log(`      ✖ não soltei a identidade (${del.status})`); pulados++; continue; }
  }
  // 2) reaponta para um usuário próprio, com external_id do CLIENTE
  const r = await setTicketRequester({ ticketId: t.id, email: dono.email, name: dono.nome || null, entityId: dono.clientId, organizationId: dono.orgId });
  console.log(r.ok ? `      ✓ requester agora é ${r.requesterId}` : `      ✖ falhou: ${r.error}`);
  if (r.ok) ok++; else pulados++;
}
console.log(`\n${APLICAR ? "aplicado" : "ENSAIO"} · corrigidos ${ok} · intocados ${pulados}`);
