/**
 * Lead do Checkatrade, de ponta a ponta (dono, 07/10/2026):
 *
 *   1. o e-mail "<Serviço> in <POSTCODE> - respond now" cai no Zendesk;
 *   2. no Checkatrade, o card do lead: "I'm interested" e o contato (telefone, e-mail);
 *   3. no OS: o contato (clients, conta Fixfy) e o lead (leads, sem publicar aos parceiros);
 *   4. o template pela linha do Zendesk (020 4538 4668) e o ticket do lead com a nota
 *      (ficha + a mensagem como o cliente leu + próxima ação);
 *   5. o e-mail do Checkatrade (que nasce resolvido) ganha a tag e uma nota com o ticket do lead.
 * Quando o cliente responde, o Harvey continua no WhatsApp e junta o ticket na conversa.
 *
 *   NODE_OPTIONS=--dns-result-order=ipv4first npx tsx scripts/harvey-wa/checkatrade-leads.mts            ensaio: lista, não clica nem manda
 *   ... --enviar                 faz tudo
 *   --limite=1                   no máximo N leads nesta rodada (padrão 10)
 *   --horas=48                   e-mails das últimas N horas (padrão 48)
 *
 * O navegador é o do Ruben (~/checkatrade-rpa, ou CHECKATRADE_RPA_DIR), com a sessão dele.
 * Lead que falha ganha a tag lead_ct_falhou e uma nota no e-mail: a equipe pega na mão.
 */
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { createServiceClient } = await import("../../src/lib/supabase/service");
const { zendeskApi } = await import("../../src/lib/zendesk");
const { decidirLead, mandarPrimeiroContato, templateDoLeadConfigurado, jaFalamosComEle, telefoneE164 } = await import("../../src/lib/harvey-wa/primeiro-contato");
const { dentroDaJanela } = await import("../../src/lib/agent/sales/dispatch-one");

const arg = (nome: string, padrao: number) => Number(process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1] ?? padrao);
const ENVIAR = process.argv.includes("--enviar");
const LIMITE = arg("limite", 10);
const HORAS = arg("horas", 48);
const RPA = process.env.CHECKATRADE_RPA_DIR || `${process.env.HOME}/checkatrade-rpa`;
const CONTA_FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
const OS_LOCAL = process.env.HARVEY_WA_OS_LOCAL || "http://localhost:3000";

if (ENVIAR && !templateDoLeadConfigurado()) throw new Error("Falta HARVEY_WA_LEAD_TEMPLATE no .env.local");
if (ENVIAR && !dentroDaJanela()) {
  console.log("Fora das 8h-20h de Londres: nada sai agora.");
  process.exit(0);
}

type EmailDoLead = { ticket: number; servico: string; postcode: string; nome: string; mensagem: string; quando: string };

/** O e-mail do Checkatrade: serviço e postcode no assunto, nome, prazo e mensagem no corpo. */
function lerEmail(t: { id: number; subject: string; description: string }): EmailDoLead | null {
  const a = t.subject.match(/^(.+?) in ([A-Z0-9 ]{4,9}) - respond now$/i);
  if (!a) return null;
  const linhas = t.description.split("\n").map((l) => l.trim()).filter(Boolean);
  const depois = (rotulo: RegExp) => {
    const i = linhas.findIndex((l) => rotulo.test(l));
    return i >= 0 ? linhas[i + 1] ?? "" : "";
  };
  // O nome pode vir quebrado em linhas ("Shahera" / "Khatun"): tudo entre "Customer" e "Start date".
  const iCli = linhas.findIndex((l) => /^Customer$/i.test(l));
  const iData = linhas.findIndex((l, i) => i > iCli && /^Start date$/i.test(l));
  const nome = iCli >= 0 ? linhas.slice(iCli + 1, iData > iCli ? iData : iCli + 2).join(" ").replace(/\s+/g, " ").trim() : "";
  const iMsg = linhas.findIndex((l) => /[’']s message$/i.test(l));
  const fim = linhas.findIndex((l, i) => i > iMsg && /I[’']m interested/i.test(l));
  const mensagem = iMsg >= 0 ? linhas.slice(iMsg + 1, fim > iMsg ? fim : iMsg + 2).join("\n") : "";
  if (!nome) return null;
  return { ticket: t.id, servico: a[1].trim(), postcode: a[2].trim().toUpperCase(), nome, mensagem, quando: depois(/^Start date$/i) };
}

async function marcar(ticket: number, tag: string, nota?: string) {
  await zendeskApi(`tickets/${ticket}/tags.json`, { method: "PUT", body: { tags: [tag] } });
  if (nota) await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: nota, public: false } } } });
}

// 1. Os e-mails ainda não processados.
const desde = new Date(Date.now() - HORAS * 3600_000).toISOString().slice(0, 10);
const busca = await zendeskApi<{ results: Array<{ id: number; subject: string; description: string; created_at: string }> }>(
  `search.json?query=${encodeURIComponent(`type:ticket subject:"respond now" created>=${desde} -tags:lead_ct_feito -tags:lead_ct_falhou`)}&sort_by=created_at&sort_order=asc`,
);
const emails = (busca.results ?? []).map(lerEmail).filter((e): e is EmailDoLead => Boolean(e)).slice(0, LIMITE);
console.log(`${emails.length} lead(s) do Checkatrade no Zendesk. ${ENVIAR ? "FAZENDO" : "Ensaio (não clica, não grava, não manda)"}.\n`);
for (const e of emails) console.log(`  #${e.ticket} · ${e.nome} · ${e.servico} · ${e.postcode} · "${e.mensagem.slice(0, 70)}"`);
if (!emails.length || !ENVIAR) process.exit(0);

// 2. O Checkatrade: um navegador para a rodada toda.
const { loadConfig } = await import(`${RPA}/src/config.ts`);
const { getOrCreateContext } = await import(`${RPA}/src/checkatrade/auth.ts`);
const { browser, page } = await getOrCreateContext(loadConfig());
const sb = createServiceClient();
const { data: catalogo } = await sb.from("service_catalog").select("*").is("deleted_at", null).eq("is_active", true);
const manutencao = (catalogo ?? []).find((c: { name: string }) => c.name === "General Maintenance") as { id: string } | undefined;

type Card = { id: string; linhas: string[] };
async function cardsDoTopo(): Promise<Card[]> {
  await page.goto("https://membersapp.checkatrade.com/jobs/all", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid^="job-card-v2-"]').first().waitFor({ timeout: 30_000 });
  const vistos = new Map<string, Card>();
  for (let volta = 0; volta < 8; volta++) {
    const cards = page.locator('[data-testid^="job-card-v2-"]');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const id = ((await cards.nth(i).getAttribute("data-testid").catch(() => null)) ?? "").slice("job-card-v2-".length);
      if (id.length < 10 || vistos.has(id)) continue;
      const linhas = ((await cards.nth(i).innerText().catch(() => "")) || "").split("\n").map((t) => t.trim()).filter(Boolean);
      vistos.set(id, { id, linhas });
    }
    await page.mouse.move(900, 500);
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(600);
  }
  return [...vistos.values()];
}

/** Abre o card, clica "I'm interested" (se ainda não) e lê telefone e e-mail do bloco do cliente. */
async function contatoDoCard(id: string, nome: string): Promise<{ telefone: string | null; email: string | null }> {
  await page.goto(`https://membersapp.checkatrade.com/jobs/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const botao = page.getByRole("button", { name: /I.m interested/i }).first();
  if (await botao.isVisible({ timeout: 5000 }).catch(() => false)) {
    await botao.click({ timeout: 10_000 });
    await page.waitForTimeout(5000);
  }
  const linhas = ((await page.locator("body").innerText().catch(() => "")) || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const i = linhas.map((l) => l.toLowerCase()).lastIndexOf(nome.toLowerCase());
  const bloco = i >= 0 ? linhas.slice(i + 1, i + 8) : [];
  const telefone = bloco.find((l) => /^\+?\d[\d\s]{9,}$/.test(l)) ?? null;
  const email = bloco.find((l) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(l)) ?? null;
  return { telefone, email };
}

const cards = await cardsDoTopo();
let feitos = 0;
try {
  for (const e of emails) {
    const card = cards.find((c) => c.linhas.some((l) => l.toUpperCase().includes(e.postcode)) && c.linhas.some((l) => l.toLowerCase().startsWith(e.nome.toLowerCase())));
    if (!card) {
      console.log(`  ❌ #${e.ticket} ${e.nome}: card não achado no quadro`);
      await marcar(e.ticket, "lead_ct_falhou", `Automatic lead flow: card for ${e.nome} (${e.postcode}) not found on the Checkatrade board. Please handle manually.`);
      continue;
    }
    const { telefone, email } = await contatoDoCard(card.id, e.nome);
    const tel = telefoneE164(telefone);
    if (!tel) {
      console.log(`  ❌ #${e.ticket} ${e.nome}: sem telefone no Checkatrade`);
      await marcar(e.ticket, "lead_ct_falhou", `Automatic lead flow: "I'm interested" sent, but no phone number came back for ${e.nome}${email ? ` (email ${email})` : ""}. Please contact them manually.`);
      continue;
    }
    // 3. OS: contato (pelo :3000, como os agentes do Mac) e lead sem publicar.
    const notes = [`checkatrade-lead:${card.id}`, `Enquiry · ${e.servico}${e.quando ? ` (${e.quando.replace(/^It[’']s /i, "")})` : ""}`, e.mensagem].filter(Boolean).join("\n\n");
    const chave = process.env.MASTER_OS_LEAD_WEBHOOK_API_KEY || process.env.MASTER_OS_JOB_WEBHOOK_API_KEY || "";
    const res = await fetch(`${OS_LOCAL}/api/contacts/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": chave },
      body: JSON.stringify({ account_id: CONTA_FIXFY, contacts: [{ name: e.nome, email, phone: tel, postcode: e.postcode, address: `London, ${e.postcode}`, notes }] }),
    });
    const ing = (await res.json().catch(() => ({}))) as { results?: Array<{ id: string }> };
    const clienteId = ing.results?.[0]?.id;
    if (!res.ok || !clienteId) {
      console.log(`  ❌ #${e.ticket} ${e.nome}: OS não gravou o contato (${res.status})`);
      await marcar(e.ticket, "lead_ct_falhou", `Automatic lead flow: the OS did not save ${e.nome} (${res.status}). Phone ${tel}.`);
      continue;
    }
    const { data: jaTemLead } = await sb.from("leads").select("id").eq("client_id", clienteId).is("deleted_at", null).limit(1);
    if (!jaTemLead?.length) {
      const { data: ref } = await sb.rpc("next_lead_ref");
      await sb.from("leads").insert({
        reference: String(ref), name: e.nome, email, phone: tel, address: `London, ${e.postcode}`, city: "London", postcode: e.postcode,
        urgency: /urgent/i.test(e.quando) ? "high" : "medium",
        scope: `${e.servico}${e.quando ? `, ${e.quando}` : ""}. Customer's request: "${e.mensagem}". First contact by WhatsApp (Harvey).`,
        status: "new", client_id: clienteId, account_id: CONTA_FIXFY, catalog_service_id: manutencao?.id ?? null, published_at: null,
      });
    }
    // 4. Template + ticket do lead com a nota.
    const { data: linha } = await sb.from("clients").select("id,full_name,email,phone,postcode,address,notes").eq("id", clienteId).single();
    const d = decidirLead(linha as never, (catalogo ?? []) as never);
    if (d.kind === "pular") {
      console.log(`  ❌ #${e.ticket} ${e.nome}: ${d.motivo}`);
      await marcar(e.ticket, "lead_ct_falhou", `Automatic lead flow: no WhatsApp sent to ${e.nome} (${d.motivo}). Phone ${tel}.`);
      continue;
    }
    if (await jaFalamosComEle(sb, tel)) {
      console.log(`  · #${e.ticket} ${e.nome}: já falamos com ele, sem template`);
      await marcar(e.ticket, "lead_ct_feito", `Automatic lead flow: ${e.nome} already has a WhatsApp conversation with us, no template sent.`);
      continue;
    }
    const r = await mandarPrimeiroContato(sb, d.contato);
    if (r.kind !== "enviado") {
      console.log(`  ❌ #${e.ticket} ${e.nome}: ${r.kind === "falhou" ? r.motivo : r.kind}`);
      await marcar(e.ticket, "lead_ct_falhou", `Automatic lead flow: the WhatsApp template did not go out to ${e.nome} (${r.kind === "falhou" ? r.motivo : r.kind}). Phone ${tel}.`);
      continue;
    }
    // 5. O e-mail do Checkatrade nasce resolvido (gatilho checkatrade_noreply) e o Zendesk não junta
    // ticket resolvido: fica a tag e a nota apontando para o ticket do lead.
    await marcar(e.ticket, "lead_ct_feito", r.ticket ? `Lead handled automatically: WhatsApp template sent, continues in #${r.ticket}.` : "Lead handled automatically: WhatsApp template sent (lead ticket could not be opened).");
    feitos++;
    console.log(`  ✅ #${e.ticket} ${e.nome} · ${tel} · ticket do lead #${r.ticket ?? "?"}`);
  }
} finally {
  await browser.close();
}
console.log(`\n${feitos} de ${emails.length} feitos.`);
