/**
 * Bateria do Harvey no WhatsApp: conversas roteirizadas contra o cérebro de
 * verdade, com preço e datas do site de verdade (o módulo do site importado
 * direto) e só o link da Stripe de mentira. Nada vai ao WhatsApp nem ao banco.
 *
 *   npx tsx scripts/harvey-wa/bateria.mts            (todas)
 *   npx tsx scripts/harvey-wa/bateria.mts eot deep   (só essas)
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const SITE = process.env.HARVEY_WA_SITE_DIR || `${process.env.HOME}/master-website-harvey`;
const { handleAgent, catalog } = await import(`${SITE}/server/b2c/agent.js`);
const { b2cServerEnv } = await import(`${SITE}/server/b2c/env.js`);
process.env.TABELA_DO_OS = "1";
// A tabela ao vivo do OS (traz a hora do handyman); sem ela o site usa a embutida, sem hora.
await (await import(`${SITE}/server/b2c/tabela.js`)).garantirTabela().catch((e: unknown) => console.log("tabela ao vivo falhou:", e));
const { pensar, ofereceDia, frasesDe, quaseIgual } = await import("../../src/lib/harvey-wa/cerebro");
const { contextoDoWelcome } = await import("../../src/lib/harvey-wa/welcome-lead");
type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string; midia?: string };

delete process.env.HARVEY_BANK_DETAILS; // usa os dados das faturas
const env = b2cServerEnv();
const chave = { "x-agent-key": env.osLeadKey || env.osKey };
const site = async (corpo: Record<string, unknown>) => {
  if (corpo.action === "bank") {
    if (process.env.DEBUG_CHECKOUT) console.log("BANK ARGS", JSON.stringify(corpo));
    const b = corpo.booking as { selection: unknown; postcode: string; promoCode?: string };
    const q = await handleAgent({ action: "quote", selection: b.selection, postcode: b.postcode, promoCode: b.promoCode }, chave);
    return { status: 200, data: { ref: "FX-TESTE2", total: q.data.total, deposit: q.data.deposit, jobs: [] } };
  }
  if (corpo.action === "checkout") {
    if (process.env.DEBUG_CHECKOUT) console.log("CHECKOUT ARGS", JSON.stringify(corpo));
    const b = corpo.booking as { selection: unknown; postcode: string; contact: { email: string; phone: string } };
    const q = await handleAgent({ action: "quote", selection: b.selection, postcode: b.postcode, promoCode: (corpo.booking as Record<string, unknown>).promoCode }, chave);
    const faltando = ["date", "window", "access", "parking"].filter((k) => !(corpo.booking as Record<string, unknown>)[k]);
    if (!b.contact?.email || faltando.length) return { status: 400, data: { error: `missing ${faltando.join(", ") || "email"}` } };
    const total = q.data.total as number;
    return { status: 200, data: { url: "https://checkout.stripe.com/c/pay/TESTE", ref: "FX-TESTE1", total, ...(corpo.deposit ? { payNow: q.data.deposit, payLater: Math.round((total - (q.data.deposit as number)) * 100) / 100 } : {}) } };
  }
  return handleAgent(corpo, chave);
};

const CONTAS = {
  reservas: async () => ({
    encontrado: true,
    reservas: [{ ref: "JOB-9001", service: "End of Tenancy Clean", address: "Flat 2, 10 Rye Lane, SE15", day: "Fri 2 Oct", arrival: "9 am to 12 pm", status: "confirmed, professional assigned", professional: "Ana", price: 266, balanceDue: null, payLink: null }],
  }),
  situacaoDoParceiro: async () => ({
    name: "Dan Clarke",
    accountStatus: "onboarding",
    canReceiveJobs: false,
    documents: [{ doc: "ID", ok: true }, { doc: "Right to work", ok: true }, { doc: "Insurance", ok: false }],
    missingToActivate: ["Insurance"],
    waitingReview: [],
    expired: [],
    upcomingJobs: [],
    portal: "https://partners.getfixfy.com",
  }),
  pedirCotacao: async () => ({ reference: "QT-TESTE-1" }),
  salvarDocumento: async (tipo: string) => ({ aprovado: true, documento: tipo === "insurance" ? "Public Liability Insurance" : tipo, motivo: null, ativacao: { ativado: true, email: { ok: true, sentTo: "dan@example.com" } } }),
};

// Nutre e passa (dono, 09/11/2026): o Harvey entende o problema, dá preço só de job pequeno
// (£72 an hour, all in, nunca "fixed") e passa para a equipe com need "close".
const CASOS: Record<string, string[]> = Object.fromEntries(Object.entries({
  pequeno: ["Hi, can you put up a curtain rail for me? I already have the rail. E17", "it is a normal plasterboard wall, about 2m", "this week if possible", "yes sounds good"],
  vazamento: ["Hi, I've got a leak under my kitchen sink", "it drips when I run the tap, been a few days", "N7, ideally this week", "yes I can send a photo later"],
  anuncio: ["Hi there! Is the handyman offer still available? (half day £180)", "I need 3 shelves up and a TV mounted on the wall", "SW11, next Saturday would be good", "I have the shelves and the bracket"],
  lista: ["Hi, I need a few things done: assemble a wardrobe and a chest of drawers, put up 4 shelves and hang 3 pictures", "E3, any day next week", "yes I have everything", "perfect"],
  encanador: ["Hi, my bathroom tap keeps dripping, can a plumber come and fix it? N16", "it is the hot tap, been a week, this week please", "yes", "ok great"],
  desconto_welcome: ["Hi, can you put up a curtain rail? I have the rail. E17", "plasterboard, this week", "hmm any discount?", "ok great"],
  caro_sem_welcome: ["Hi, can you put up a curtain rail? I have the rail. E17", "plasterboard, this week", "that's a bit expensive", "ok fine"],
  limpeza: ["Hi, how much for an end of tenancy clean?", "moving out on the 20th, 2 bed 1 bath, SE15", "no carpets, just the oven is a bit grim", "ok lets do it"],
} as Record<string, string[]>).filter(([k]) => !process.argv[2] || process.argv.slice(2).includes(k)));
const siteOriginal = site;
const siteLog = async (c: Record<string, unknown>) => { if (c.action === "quote" && process.env.DEBUG_QUOTE) console.log("    · quote", JSON.stringify(c.selection)); return siteOriginal(c); };
const cat = catalog();
for (const [nome, msgs] of Object.entries(CASOS)) {
  const conversa: Fala[] = [];
  const out = [`\n=== ${nome}`];
  let passou: string | null = null, need: string | null = null, link = false;
  for (const m of msgs) {
    conversa.push({ papel: "cliente", texto: m });
    out.push(`  👤 ${m}`);
    const r = await pensar(conversa, { telefone: "+447700900123", nomeNoWhatsApp: "Test", campanha: "teste", contas: CONTAS, fotos: [], sobreQuem: nome === "desconto_welcome" ? contextoDoWelcome({ codigo: "WELCOME10", email: "x@example.com" }) : undefined }, siteLog, cat);
    const resp = r.resposta ?? "(sem resposta)";
    conversa.push({ papel: "harvey", texto: resp });
    if (r.checkout) link = true;
    out.push(`  🤖 ${resp.replace(/\n/g, "\n     ")}   [${r.ferramentas.join(",")}${r.passarParaEquipe ? ` · PASSOU need=${r.precisaDe}: ${r.passarParaEquipe}` : ""}]`);
    if (r.passarParaEquipe) { passou = r.passarParaEquipe; need = r.precisaDe ?? null; break; }
  }
  const t = conversa.filter((f) => f.papel === "harvey").map((f) => f.texto).join("\n");
  const ultima = conversa.filter((f) => f.papel === "harvey").slice(-1)[0]?.texto ?? "";
  const harv = conversa.filter((f) => f.papel === "harvey").map((f) => f.texto);
  const aberturas = harv.map((x) => x.split(/[ ,.!]/)[0].toLowerCase());
  const p = [/£\d/.test(ultima) && passou && "preço e passagem na mesma mensagem", new Set(aberturas).size < aberturas.length && aberturas.length > 2 && `abriu igual: ${aberturas.join("/")}`, /£\d/.test(harv[0] ?? "") && !/how much/i.test(msgs[0]) && "preço na 1ª resposta sem pedirem",/£72 fixed|hour is fixed/i.test(t) && "disse fixed", /no call.?out fee|tools included/i.test(t) && "disse no call out fee", !passou && "não passou", passou && need !== "close" && `need=${need}`, link && "mandou link", /[—–]/.test(t) && "travessão"].filter(Boolean);
  out.push(p.length ? `  ❌ ${p.join(" · ")}` : "  ✅ ok");
  console.log(out.join("\n"));
}
