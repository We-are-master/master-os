/**
 * Confere a espinha das organizações: Zendesk ↔ OS, e quem ficou órfão.
 *
 * O Harvey só age quando reconhece a organização do remetente (dono,
 * 03/09/2026). Para isso, três coisas têm que estar certas ao mesmo tempo, e
 * hoje nenhuma delas está inteira:
 *
 *   1. Toda organização do OS existe no Zendesk e aponta de volta pelo
 *      `external_id`, como os parceiros já fazem (`fixfy:partner:<uuid>`).
 *   2. Todo usuário do Zendesk cujo domínio é de uma organização está COLADO
 *      nela. O Zendesk só cola no momento em que o usuário nasce: quem já
 *      existia quando o domínio foi cadastrado ficou órfão para sempre. É o
 *      caso da `sabrinabraz@lifung.com`, da conta que mais faturou na
 *      história da empresa.
 *   3. Todo cliente do OS com e-mail de domínio de organização está ligado a
 *      ela. São 21 hoje.
 *
 * Sem `--aplicar` só mostra. Foto do estado antes vai para `.logs/`.
 *
 *   npx tsx scripts/organizacoes-conferir.mts
 *   npx tsx scripts/organizacoes-conferir.mts --aplicar
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { carregarOrganizacoes } from "../src/lib/organizacoes/carregar";
import { dominioDe, reconhecerOrganizacao } from "../src/lib/organizacoes/reconhecer";

loadEnvLocal();
const APLICAR = process.argv.includes("--aplicar");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

const ZD = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const AUTH =
  "Basic " +
  Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");

async function zd<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${ZD}${caminho}`, {
    ...init,
    headers: { Authorization: AUTH, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Zendesk ${caminho}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/** O `external_id` que liga a organização do Zendesk à do OS. */
const marcaDaOrg = (id: string) => `fixfy:account:${id}`;

type OrgZendesk = { id: number; name: string; domain_names: string[]; external_id: string | null };

// ── 1. o que existe dos dois lados ──────────────────────────────────────────
const organizacoes = await carregarOrganizacoes(sb);
console.log(`ORGANIZAÇÕES no OS com domínio: ${organizacoes.length}`);
for (const o of organizacoes) console.log(`  ${o.nome.padEnd(24)} ${o.dominios.join(", ")}`);

const orgsZd: OrgZendesk[] = [];
{
  let url = "/organizations.json?per_page=100";
  while (url) {
    const j = await zd<{ organizations: OrgZendesk[]; next_page: string | null }>(url);
    orgsZd.push(...j.organizations);
    url = j.next_page ? j.next_page.replace(ZD, "") : "";
  }
}
console.log(`\nORGANIZATIONS no Zendesk: ${orgsZd.length}`);

/** Casa pelo domínio primeiro, pelo nome depois. Nome sozinho erra acento e "LTD". */
const soLetras = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function acharNoZendesk(org: { nome: string; dominios: string[] }): OrgZendesk | null {
  for (const z of orgsZd) {
    const domsZd = (z.domain_names ?? []).map((d) => dominioDe(d)).filter(Boolean) as string[];
    if (domsZd.some((d) => org.dominios.includes(d))) return z;
  }
  const alvo = soLetras(org.nome);
  return orgsZd.find((z) => soLetras(z.name).includes(alvo) || alvo.includes(soLetras(z.name))) ?? null;
}

// ── 2. o elo Zendesk → OS ───────────────────────────────────────────────────
const paraLigar: Array<{ zd: OrgZendesk; osId: string; osNome: string; dominiosFaltando: string[] }> = [];
const semOrgNoZendesk: string[] = [];
for (const o of organizacoes) {
  const z = acharNoZendesk(o);
  if (!z) {
    semOrgNoZendesk.push(o.nome);
    continue;
  }
  const domsZd = ((z.domain_names ?? []).map((d) => dominioDe(d)).filter(Boolean) as string[]);
  const faltando = o.dominios.filter((d) => !domsZd.includes(d));
  const precisaId = z.external_id !== marcaDaOrg(o.id);
  if (precisaId || faltando.length > 0) {
    paraLigar.push({ zd: z, osId: o.id, osNome: o.nome, dominiosFaltando: faltando });
  }
}
console.log(`\nORGANIZAÇÕES a ligar no Zendesk: ${paraLigar.length}`);
for (const p of paraLigar) {
  const oQue = [
    p.zd.external_id !== marcaDaOrg(p.osId) ? `external_id → ${marcaDaOrg(p.osId)}` : null,
    p.dominiosFaltando.length ? `domínios += ${p.dominiosFaltando.join(", ")}` : null,
  ].filter(Boolean);
  console.log(`  ${p.zd.name.padEnd(26)} ${oQue.join(" · ")}`);
}
if (semOrgNoZendesk.length) console.log(`  sem organização no Zendesk: ${semOrgNoZendesk.join(", ")}`);

// ── 3. usuários órfãos no Zendesk ───────────────────────────────────────────
const orfaosZd: Array<{ id: number; email: string; org: { id: string; nome: string }; zdOrgId: number }> = [];
for (const o of organizacoes) {
  const z = acharNoZendesk(o);
  if (!z) continue;
  for (const d of o.dominios) {
    const j = await zd<{ results: Array<{ id: number; email: string; organization_id: number | null; role: string }> }>(
      `/search.json?query=${encodeURIComponent(`type:user ${d}`)}&per_page=100`,
    );
    for (const u of j.results ?? []) {
      if (!u.email || u.organization_id) continue;
      if (dominioDe(u.email) !== d && !String(dominioDe(u.email) ?? "").endsWith(`.${d}`)) continue;
      orfaosZd.push({ id: u.id, email: u.email, org: { id: o.id, nome: o.nome }, zdOrgId: z.id });
    }
  }
}
console.log(`\nUSUÁRIOS órfãos no Zendesk (domínio de organização, sem organização): ${orfaosZd.length}`);
for (const u of orfaosZd) console.log(`  ${u.email.padEnd(34)} → ${u.org.nome}`);

// ── 4. clientes órfãos no OS ────────────────────────────────────────────────
const { data: clientesRaw } = await sb
  .from("clients")
  .select("id, full_name, email, source_account_id")
  .is("deleted_at", null)
  .not("email", "is", null);
const orfaosOs: Array<{ id: string; nome: string; email: string; org: { id: string; nome: string } }> = [];
for (const c of (clientesRaw ?? []) as Array<{ id: string; full_name: string; email: string; source_account_id: string | null }>) {
  if (c.source_account_id) continue;
  const r = reconhecerOrganizacao(c.email, organizacoes);
  if (r.tipo !== "organizacao") continue;
  orfaosOs.push({ id: c.id, nome: c.full_name, email: c.email, org: { id: r.id, nome: r.nome } });
}
console.log(`\nCLIENTES órfãos no OS (e-mail de organização, sem organização): ${orfaosOs.length}`);
for (const c of orfaosOs) console.log(`  ${String(c.nome).padEnd(30)} ${c.email.padEnd(34)} → ${c.org.nome}`);

if (!APLICAR) {
  console.log("\n(ensaio — nada mudou. Use --aplicar)\n");
  process.exit(0);
}

// ── aplicar ─────────────────────────────────────────────────────────────────
mkdirSync(join(process.cwd(), ".logs"), { recursive: true });
writeFileSync(
  join(process.cwd(), ".logs", `organizacoes-antes-${new Date().toISOString().slice(0, 10)}.json`),
  JSON.stringify({ orgsZd, paraLigar, orfaosZd, orfaosOs }, null, 2),
);

for (const p of paraLigar) {
  const domsZd = ((p.zd.domain_names ?? []).map((d) => dominioDe(d)).filter(Boolean) as string[]);
  await zd(`/organizations/${p.zd.id}.json`, {
    method: "PUT",
    body: JSON.stringify({
      organization: {
        external_id: marcaDaOrg(p.osId),
        domain_names: [...new Set([...domsZd, ...p.dominiosFaltando])],
      },
    }),
  });
  console.log(`  ✔ ${p.zd.name}: ligada ao OS`);
}

for (const u of orfaosZd) {
  await zd(`/users/${u.id}.json`, {
    method: "PUT",
    body: JSON.stringify({ user: { organization_id: u.zdOrgId } }),
  });
  console.log(`  ✔ ${u.email} → ${u.org.nome}`);
}

for (const c of orfaosOs) {
  const { error } = await sb.from("clients").update({ source_account_id: c.org.id }).eq("id", c.id);
  if (error) console.error(`  ✖ ${c.email}: ${error.message}`);
  else console.log(`  ✔ ${c.nome} → ${c.org.nome}`);
}

console.log(
  `\nfeito: ${paraLigar.length} organização(ões), ${orfaosZd.length} usuário(s) do Zendesk, ${orfaosOs.length} cliente(s) do OS\n`,
);
