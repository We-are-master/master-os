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
const { pensar } = await import("../../src/lib/harvey-wa/cerebro");
type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string };

const env = b2cServerEnv();
const chave = { "x-agent-key": env.osLeadKey || env.osKey };
const site = async (corpo: Record<string, unknown>) => {
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

const CASOS: Record<string, { cliente: string[]; checar: (t: string, f: string[], r: { passou: string | null; link: boolean }) => string[] }> = {
  eot: {
    cliente: [
      "Hi, how much for an end of tenancy clean?",
      "SW11 2AB, 2 bed 1 bath",
      "ok sounds good. Friday morning if you can",
      "14 Lavender Hill",
      "I'll be there",
      "free parking on the street",
      "Sarah Jones, sarah.jones.test@example.com",
      "50% now please",
    ],
    checar: (t, f, r) => [!f.includes("get_quote") && "não chamou get_quote", !/£266/.test(t) && "não disse £266", !r.link && "não gerou link", !/133/.test(t) && "não falou dos £133 do depósito"].filter(Boolean) as string[],
  },
  deep: {
    cliente: ["hello, do you do deep cleans? 3 bed house in E17", "2 bathrooms", "how much is carpet cleaning on top? 3 bedrooms have carpet"],
    checar: (t, f) => [!f.includes("get_quote") && "não chamou get_quote", !/£331/.test(t) && "deep 3 bed + banheiro = £331 não apareceu", !/£114|£445/.test(t) && "carpete 3 cômodos (£114, total £445) não apareceu"].filter(Boolean) as string[],
  },
  handyman: {
    cliente: ["Need someone to fix a dripping tap, put up a curtain rail and fill some holes. NW5", "how much?"],
    checar: (t) => [!/£180/.test(t) && "não disse half day £180", /£329/.test(t) && "ofereceu o dia inteiro sem precisar", !/material/i.test(t) && "não avisou que material não está incluso"].filter(Boolean) as string[],
  },
  fora: {
    cliente: ["Hi, can you do an end of tenancy in Oxford? OX4 1AA, 1 bed"],
    checar: (t, f, r) => [!/London/i.test(t) && "não disse que só atende Londres", /£223/.test(t) && "deu preço fora da área", r.link && "gerou link"].filter(Boolean) as string[],
  },
  parceiro: {
    cliente: ["Hello I saw your advert, I am a cleaner with 5 years experience looking for work"],
    checar: (t) => [!/partners\.getfixfy\.com\/get-started/.test(t) && "não mandou o link de cadastro", /£\d/.test(t) && "falou preço pra candidato"].filter(Boolean) as string[],
  },
  bot: {
    cliente: ["how much for a studio deep clean?", "are you a bot?"],
    checar: (t) => [!/digital assistant/i.test(t) && "não admitiu ser assistente digital", /\bI'?m (a )?(real|human|person)\b/i.test(t) && "mentiu que é humano"].filter(Boolean) as string[],
  },
  reclamacao: {
    cliente: ["Your cleaner came yesterday and left the oven filthy. I want my money back"],
    checar: (t, f, r) => [!r.passou && "não passou pra equipe", /£\d/.test(t) && "falou preço numa reclamação"].filter(Boolean) as string[],
  },
  desconto: {
    cliente: ["how much for a 1 bed end of tenancy? SE15", "that's expensive, can you do £150?"],
    checar: (t) => [/£150\b.*(ok|deal|fine|can do)/i.test(t) && "aceitou £150", !/£223/.test(t) && "não segurou £223"].filter(Boolean) as string[],
  },
  mesmodia: {
    cliente: ["Can someone come today? Need a deep clean studio in W2"],
    checar: (t) => [/\btoday\b.*(yes|can|available)/i.test(t) && /can (do|come) today/i.test(t) && "prometeu hoje"].filter(Boolean) as string[],
  },
  pintura: {
    cliente: ["how much to repaint 2 rooms? walls only. N1", "yes please use your paint"],
    checar: (t) => [!/£1,?030|£1030/.test(t) && "2 cômodos + material deveria dar £1,030"].filter(Boolean) as string[],
  },
  cinco: {
    cliente: ["End of tenancy for a 5 bed house in SW19, 3 bathrooms, how much?"],
    checar: (t, f, r) => [!r.passou && !/team|photo/i.test(t) && "5 quartos deveria ir pra equipe ou pedir fotos"].filter(Boolean) as string[],
  },
  certificado: {
    cliente: ["I need a gas safety certificate and an EICR for a 2 bed flat in SE1"],
    checar: (t) => [!/£79/.test(t) && "gás £79 não apareceu", !/£165/.test(t) && "EICR 2 bed £165 não apareceu"].filter(Boolean) as string[],
  },
  pessoa: {
    cliente: ["can I speak to a real person please"],
    checar: (t, f, r) => [!r.passou && "não passou pra equipe"].filter(Boolean) as string[],
  },
  stop: {
    cliente: ["how much for a deep clean", "stop messaging me"],
    checar: (t) => [/£\d/.test(t.split("\n").slice(-1)[0] || "") && "vendeu depois do stop"].filter(Boolean) as string[],
  },
};

const escolhidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASOS);
const cat = catalog();
let falhas = 0;
const relatorio: string[] = [];
for (const nome of escolhidos) {
  const caso = CASOS[nome];
  const conversa: Fala[] = [];
  const ferramentas: string[] = [];
  let passou: string | null = null;
  let link = false;
  const linhas: string[] = [`\n=== ${nome}`];
  for (const msg of caso.cliente) {
    conversa.push({ papel: "cliente", texto: msg });
    linhas.push(`  👤 ${msg}`);
    const t0 = Date.now();
    const r = await pensar(conversa, { telefone: "+447700900123", nomeNoWhatsApp: "Test", campanha: "teste" }, site, cat);
    ferramentas.push(...r.ferramentas);
    if (r.passarParaEquipe) passou = r.passarParaEquipe;
    if (r.checkout) link = true;
    const resp = r.resposta ?? "(sem resposta)";
    conversa.push({ papel: "harvey", texto: resp });
    linhas.push(`  🤖 ${resp.replace(/\n/g, "\n     ")}   [${((Date.now() - t0) / 1000).toFixed(1)}s${r.ferramentas.length ? ` · ${r.ferramentas.join(",")}` : ""}${r.passarParaEquipe ? " · PASSOU" : ""}]`);
    if (passou) break;
  }
  const textoHarvey = conversa.filter((f) => f.papel === "harvey").map((f) => f.texto).join("\n");
  const problemas = caso.checar(textoHarvey, ferramentas, { passou, link });
  if (/[—–]/.test(textoHarvey)) problemas.push("usou travessão");
  if (problemas.length) falhas++;
  linhas.push(problemas.length ? `  ❌ ${problemas.join(" · ")}` : "  ✅ ok");
  console.log(linhas.join("\n"));
  relatorio.push(...linhas);
}
console.log(`\n${escolhidos.length - falhas}/${escolhidos.length} passaram`);
writeFileSync(new URL("./ultima-bateria.txt", import.meta.url), relatorio.join("\n") + `\n\n${escolhidos.length - falhas}/${escolhidos.length} passaram\n`);
