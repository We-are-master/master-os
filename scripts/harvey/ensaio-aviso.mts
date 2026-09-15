/**
 * Ensaio de ponta a ponta do aviso de cotação, em ticket NOSSO.
 *
 * Regra do dono (15/09/2026): teste nunca em ticket de cliente. Este script
 * cria os próprios tickets com o e-mail pessoal do Victor como requester, fala
 * com eles, confere o resultado e diz o que achou.
 *
 *   npx tsx scripts/harvey/ensaio-aviso.mts
 *
 * Quatro provas, nesta ordem:
 *   1. com endereço  → sai "estamos cotando", ticket vai para 🟤 Bidding
 *   2. de novo       → CALADO, porque a tag já está lá
 *   3. sem endereço  → sai "confirme o postcode", ticket vai para 🟠 On Hold
 *   4. gmail de verdade (sem forçar a organização) → CALADO
 *
 * A quarta é a que importa mais: é a trava que impede "Hi Team" de chegar na
 * casa de um morador.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const linha of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]!] ??= m[2]!.replace(/^["']|["']$/g, "");
}
/** O ensaio arma o aviso só para si mesmo, sem depender do que está no .env. */
process.env.HARVEY_QUOTE_ACK = "1";

const CLIENTE = "victorhsouz@gmail.com";
const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const auth = "Basic " + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");
const H = { Authorization: auth, "content-type": "application/json" };

const { avisarNoTicket, TAG_AVISO_COTANDO, TAG_AVISO_POSTCODE } = await import("../../src/lib/zendesk-quoter/aviso-de-cotacao");

async function criarTicket(assunto: string, corpo: string): Promise<number> {
  const r = await fetch(`${base}/tickets.json`, {
    method: "POST", headers: H,
    body: JSON.stringify({ ticket: {
      subject: assunto,
      comment: { public: true, body: corpo },
      requester: { name: "Victor (ensaio)", email: CLIENTE },
      tags: ["harvey_ensaio"],
    } }),
  });
  if (!r.ok) throw new Error(`criar ticket: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json() as { ticket: { id: number } }).ticket.id;
}

async function olhar(id: number) {
  const t = await (await fetch(`${base}/tickets/${id}.json`, { headers: { Authorization: auth } })).json() as {
    ticket: { custom_status_id: number; tags: string[] };
  };
  const c = await (await fetch(`${base}/tickets/${id}/comments.json?include=users`, { headers: { Authorization: auth } })).json() as {
    comments: Array<{ author_id: number; public: boolean; body: string }>;
    users?: Array<{ id: number; name: string }>;
  };
  const quem = new Map((c.users ?? []).map((u) => [u.id, u.name]));
  const publicos = c.comments.filter((x) => x.public);
  const ultimo = publicos.at(-1)!;
  return {
    status: t.ticket.custom_status_id,
    tags: t.ticket.tags,
    publicos: publicos.length,
    autor: quem.get(ultimo.author_id) ?? String(ultimo.author_id),
    texto: ultimo.body.replace(/\s+/g, " ").trim(),
  };
}

const NOMES: Record<number, string> = { 5679191543071: "🆕 New", 5688282472223: "🟤 Bidding", 5679178036127: "🟠 On Hold" };
const falhas: string[] = [];
const conferir = (ok: boolean, o_que: string) => {
  console.log(`   ${ok ? "✔" : "✘"} ${o_que}`);
  if (!ok) falhas.push(o_que);
};

// ── 1 e 2: com endereço ────────────────────────────────────────────────────
console.log("\n■ 1. Com endereço, convites saíram");
const comEndereco = await criarTicket(
  "Quote request: repaint hallway (ENSAIO — ignore)",
  "Hi, we'd like a price to repaint the hallway at 12 Test Street, W14 0JG. Thanks.",
);
console.log(`   ticket #${comEndereco} criado para ${CLIENTE}`);
console.log("  ", (await avisarNoTicket({
  ticketId: comEndereco, tags: [], temEndereco: true, convitesEnviados: 5, orgReconhecida: true, postar: true,
})).replace(/\n/g, " | "));
{
  const v = await olhar(comEndereco);
  conferir(v.status === 5688282472223, `ticket foi para Bidding (está em ${NOMES[v.status] ?? v.status})`);
  conferir(v.tags.includes(TAG_AVISO_COTANDO), `tag ${TAG_AVISO_COTANDO} carimbada`);
  conferir(v.autor === "Leonardo Piovesan", `quem assinou foi o Leo (assinou: ${v.autor})`);
  conferir(/working on a quote/.test(v.texto), "o texto é o de cotação");
  conferir(!/Fixfy|Leo,|Victor/.test(v.texto), "sem assinatura no corpo");
  console.log(`   « ${v.texto.slice(0, 88)}… »`);

  console.log("\n■ 2. Mesmo ticket, segunda passada (a tag é a trava)");
  const antes = v.publicos;
  console.log("  ", (await avisarNoTicket({
    ticketId: comEndereco, tags: v.tags, temEndereco: true, convitesEnviados: 5, orgReconhecida: true, postar: true,
  })).replace(/\n/g, " | "));
  conferir((await olhar(comEndereco)).publicos === antes, "nenhum comentário público novo");
}

// ── 3: sem endereço ────────────────────────────────────────────────────────
console.log("\n■ 3. Sem endereço nenhum");
const semEndereco = await criarTicket(
  "Quote request: bathroom tap leaking (ENSAIO — ignore)",
  "Hi, could you price replacing a leaking bathroom tap? Thanks.",
);
console.log(`   ticket #${semEndereco} criado para ${CLIENTE}`);
console.log("  ", (await avisarNoTicket({
  ticketId: semEndereco, tags: [], temEndereco: false, convitesEnviados: 0, orgReconhecida: true, postar: true,
})).replace(/\n/g, " | "));
{
  const v = await olhar(semEndereco);
  conferir(v.status === 5679178036127, `ticket foi para On Hold (está em ${NOMES[v.status] ?? v.status})`);
  conferir(v.tags.includes(TAG_AVISO_POSTCODE), `tag ${TAG_AVISO_POSTCODE} carimbada`);
  conferir(/confirm the property postcode/.test(v.texto), "o texto pede o postcode");
  conferir(!/working on a quote/.test(v.texto), "não promete preço");
  console.log(`   « ${v.texto.slice(0, 88)}… »`);
}

// ── 4: a trava que protege o morador ───────────────────────────────────────
console.log("\n■ 4. Organização NÃO reconhecida (é o caso real deste gmail)");
const terceiro = await criarTicket(
  "Quote request: fence panel (ENSAIO — ignore)",
  "Hi, price to replace a fence panel at 9 Test Road, SW2 1AA?",
);
console.log(`   ticket #${terceiro} criado para ${CLIENTE}`);
console.log("  ", (await avisarNoTicket({
  ticketId: terceiro, tags: [], temEndereco: true, convitesEnviados: 5, orgReconhecida: false, postar: true,
})).replace(/\n/g, " | "));
{
  const v = await olhar(terceiro);
  conferir(v.publicos === 1, `só o comentário original do cliente (públicos: ${v.publicos})`);
  conferir(v.status === 5679191543071, `ticket continua em New (está em ${NOMES[v.status] ?? v.status})`);
}

console.log(`\n${falhas.length ? `✘ ${falhas.length} falha(s):\n  ${falhas.join("\n  ")}` : "✔ as quatro provas passaram"}`);
console.log(`\nTickets do ensaio: #${comEndereco}, #${semEndereco}, #${terceiro} — tag harvey_ensaio, dá para fechar todos de uma vez.`);
