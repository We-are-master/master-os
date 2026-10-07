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
const { pensar, ofereceDia } = await import("../../src/lib/harvey-wa/cerebro");
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

// Foto de teste: mancha de infiltração num teto branco (desenhada, só para o modelo ver algo).
const { default: sharp } = await import("sharp");
const svgTeto = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#f2f0ea"/><ellipse cx="400" cy="280" rx="210" ry="150" fill="#b8925a" opacity="0.55"/><ellipse cx="410" cy="290" rx="140" ry="95" fill="#8a6435" opacity="0.6"/><ellipse cx="420" cy="300" rx="60" ry="40" fill="#5c3f1e" opacity="0.7"/><line x1="0" y1="560" x2="800" y2="560" stroke="#ccc" stroke-width="6"/></svg>`;
const FOTO_TETO = `data:image/png;base64,${(await sharp(Buffer.from(svgTeto)).png().toBuffer()).toString("base64")}`;

const CASOS: Record<string, { quem?: "parceiro" | "cliente"; sobre?: string; abertura?: string; cliente: string[]; checar: (t: string, f: string[], r: { passou: string | null; link: boolean }) => string[] }> = {
  eot: {
    cliente: [
      "Hi, how much for an end of tenancy clean?",
      "SW11 2AB, 2 bed 1 bath",
      "ok sounds good. Friday morning if you can",
      "14 Lavender Hill",
      "I'll be there",
      "free parking on the street",
      "Sarah Jones, sarah.jones.test@example.com",
      "card link please",
    ],
    checar: (t, f, r) => [!f.includes("get_quote") && "não chamou get_quote", !/£266/.test(t) && "não disse £266", !r.link && "não gerou link", !/133/.test(t) && "não falou dos £133 do depósito"].filter(Boolean) as string[],
  },
  banco: {
    cliente: [
      "Hi, how much for an end of tenancy clean?",
      "SW11 2AB, 2 bed 1 bath",
      "ok sounds good. Friday morning if you can",
      "14 Lavender Hill",
      "I'll be there",
      "free parking on the street",
      "Sarah Jones, sarah.jones.test@example.com",
      "I'll do a bank transfer",
    ],
    checar: (t, f, r) =>
      [
        !r.passou && "não passou para a equipe",
        /12345678|06913415|sort code/i.test(t) && "mandou dados do banco (só cartão agora)",
        !/team/i.test(t.split(/bank transfer/i).slice(-1)[0] ?? "") && "não disse que a equipe resolve",
      ].filter(Boolean) as string[],
  },
  deep: {
    cliente: ["hello, do you do deep cleans? 3 bed house in E17", "2 bathrooms", "how much is carpet cleaning on top? 3 bedrooms have carpet"],
    checar: (t, f) => [!f.includes("get_quote") && "não chamou get_quote", !/£331/.test(t) && "deep 3 bed + banheiro = £331 não apareceu", !/£114|£445/.test(t) && "carpete 3 cômodos (£114, total £445) não apareceu"].filter(Boolean) as string[],
  },
  handyman: {
    cliente: ["Need someone to fix a dripping tap, put up a curtain rail and fill some holes. NW5", "how much?"],
    checar: (t) => [!/£180/.test(t) && "não disse half day £180", /£329/.test(t) && "ofereceu o dia inteiro sem precisar", !/material|part/i.test(t) && "não avisou que material não está incluso"].filter(Boolean) as string[],
  },
  handyman_dia: {
    cliente: ["Need a handyman to put up 2 shelves and fix a door handle, N7", "ok £180 is fine. when can you come?"],
    checar: (t, f) => [!f.includes("get_available_dates") && "não consultou a agenda antes de falar de dia", !/£180/.test(t) && "não disse half day £180"].filter(Boolean) as string[],
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
    checar: (t) => [/\b(yes|ok|okay|deal|fine|sure)\b[^.]{0,30}£150|£150\b[^.]{0,20}\b(is fine|works|deal|ok)\b/i.test(t) && "aceitou £150", !/£223/.test(t) && "não segurou £223"].filter(Boolean) as string[],
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
    checar: (t) => [!(/£244/.test(t) || (/£79/.test(t) && /£165/.test(t))) && "nem o total £244 nem os dois preços (£79 + £165)"].filter(Boolean) as string[],
  },
  banho: {
    cliente: ["I need help with my bath"],
    checar: (t) => [!/I['’]?m Harvey/i.test(t) && "não se apresentou na primeira resposta", !/\?/.test(t) && "não fez a pergunta pra entender o problema"].filter(Boolean) as string[],
  },
  semvaga: {
    cliente: ["Hi, how much for a deep clean? 1 bed in SW4, 1 bathroom", "ok I'd like to book please"],
    checar: (t, f, r) => [r.link && "gerou link sem dia livre", !r.passou && "sem dia livre, não passou pra equipe", /see(ing)? (live )?dates|system|tool/i.test(t) && "falou de sistema"].filter(Boolean) as string[],
  },
  parceiro_docs: {
    quem: "parceiro",
    sobre: "Partner in our system: Dan Clarke (DC Cleaning Ltd), Cleaner, account status onboarding.",
    cliente: ["hi mate, what do I still need to send to start getting jobs?", "[image sent]"],
    checar: (t, f) =>
      [
        !f.includes("get_my_account") && "não consultou a conta",
        !/insurance/i.test(t) && "não disse que falta o seguro",
        !f.includes("save_document") && "não salvou o documento",
        !/approved/i.test(t) && "não confirmou o documento",
        !/partners\.getfixfy\.com/.test(t) && "não mandou pro portal depois de ativar",
      ].filter(Boolean) as string[],
  },
  cliente_update: {
    quem: "cliente",
    sobre: "Existing customer in our system: Laura Mills. They may be asking about a booking: use get_my_bookings.",
    cliente: ["Hi, what time is the cleaner coming on Friday?"],
    checar: (t, f) => [!f.includes("get_my_bookings") && "não consultou as reservas", !/9|nine/i.test(t) && "não disse a janela de chegada", /£\d/.test(t) && !/balance|pay/i.test(t) && "falou de preço sem motivo"].filter(Boolean) as string[],
  },
  ordem_bagunçada: {
    cliente: ["Card", "Deep clean 1 bed 1 bath, E17", "yes that's all", "the first morning you have", "7 Classon Close E17 4QS", "I'll be there", "free parking", "Victor Souza, victor.test@example.com"],
    checar: (t, f, r) =>
      [
        /card (payment )?link or bank/i.test(t) && "perguntou cartão ou banco (cartão é o padrão)",
        (t.match(/£194/g) ?? []).length > 2 && "repetiu o preço",
        /£232|£38/.test(t.split(/Classon Close/).slice(-1)[0] ?? "") && "pôs extra que o cliente não pediu",
        !/£194/.test(t.split(/Classon Close/).slice(-1)[0] ?? "") && "total final diferente do aceito",
        !r.link && "não fechou com o link",
      ].filter(Boolean) as string[],
  },
  foto_cotacao: {
    cliente: ["Hi, water is coming through my ceiling, can you sort it?", "[image sent]", "yes please, send me a quote", "SE15 4QN, Tom Hart, tom.hart@example.com"],
    checar: (t, f, r) =>
      [
        !f.includes("request_quote") && "não pediu a cotação",
        /£\d/.test(t) && "chutou preço",
        !r.passou && "não passou para a equipe depois da cotação",
      ].filter(Boolean) as string[],
  },
  sem_servico: {
    cliente: ["I want to book a job for tomorrow"],
    checar: (t, f) => [f.includes("get_available_dates") && "ofereceu dia sem saber o serviço", /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/.test(t) && "falou dia antes do serviço", !/\?/.test(t) && "não perguntou o que é"].filter(Boolean) as string[],
  },
  pessoa: {
    cliente: ["can I speak to a real person please"],
    checar: (t, f, r) => [!r.passou && "não passou pra equipe"].filter(Boolean) as string[],
  },
  // As mensagens prontas dos anúncios de WhatsApp (30/09/2026): "offer" é o preço do anúncio.
  ad_deep: {
    cliente: ["Hi there! Is the deep clean offer still available? (from £174)", "2 bed flat in SW11, 1 bathroom"],
    checar: (t, f) => [!/\b(yes|yep|still)\b/i.test(t.split("\n")[0]) && "não confirmou que está de pé", /no (special )?offer|not an offer|isn'?t an offer/i.test(t) && "disse que não tem oferta", !f.includes("get_quote") && "não chamou get_quote", !/£237/.test(t) && "não disse £237", /discount|% off/i.test(t) && "inventou desconto"].filter(Boolean) as string[],
  },
  ad_eot: {
    cliente: ["Hi there! Is the end of tenancy clean offer still available? (from £200)", "studio in E3"],
    checar: (t, f) => [!/\b(yes|yep|still)\b/i.test(t.split("\n")[0]) && "não confirmou que está de pé", /no (special )?offer|not an offer|isn'?t an offer/i.test(t) && "disse que não tem oferta", !/£200/.test(t) && "não disse £200", /discount|% off/i.test(t) && "inventou desconto"].filter(Boolean) as string[],
  },
  ad_handyman: {
    cliente: ["Hi there! Is the handyman offer still available? (half day £180)", "shelves up and a sticking door. N16"],
    checar: (t) => [!/\b(yes|yep|still)\b/i.test(t.split("\n")[0]) && "não confirmou que está de pé", /no (special )?offer|not an offer|isn'?t an offer/i.test(t) && "disse que não tem oferta", !/£180/.test(t) && "não disse £180", !/material|part/i.test(t) && "não avisou que material não está incluso", /discount|% off/i.test(t) && "inventou desconto"].filter(Boolean) as string[],
  },
  ad_paint: {
    cliente: ["Hi there! Is the painter offer still available? (touch-ups £215)", "just touch ups before I move out, 1 bed in NW6"],
    checar: (t) => [!/\b(yes|yep|still)\b/i.test(t.split("\n")[0]) && "não confirmou que está de pé", /no (special )?offer|not an offer|isn'?t an offer/i.test(t) && "disse que não tem oferta", !/£215/.test(t) && "não disse £215", /discount|% off/i.test(t) && "inventou desconto"].filter(Boolean) as string[],
  },
  checkatrade_lead: {
    quem: "cliente",
    abertura: "Hi Sarah, it's Harvey from Fixfy. We've got your Checkatrade request for handyman work in the NW5 area and we can help. Could you tell me a bit more about the job, or send a couple of photos? I'll come back with a fixed price.",
    sobre:
      'This person asked for a quote on Checkatrade and we messaged them first (our message is the first one in this chat, so you have already introduced yourself: do not say "I\'m Harvey" again). Name: Sarah Jones. Postcode: NW5 1AB. What they asked for, in their words: "Need 3 shelves put up and a curtain pole in the bedroom". Pick up from their request: if it fits the catalogue, ask only what is missing and quote; if it does not, offer a proper quote (request_quote).',
    cliente: ["Hi yes, it's the shelves and the curtain pole"],
    checar: (t, f) => [/I['’]m Harvey/i.test(t.split("\n").slice(1).join("\n")) && "se apresentou de novo", !/£180/.test(t) && "não cotou a meia diária (£180)", !f.includes("get_quote") && "não chamou get_quote", !/material|part/i.test(t) && "não avisou que material não está incluso"].filter(Boolean) as string[],
  },
  stop: {
    cliente: ["how much for a deep clean", "stop messaging me"],
    checar: (t) => [/£\d/.test(t.split("\n").slice(-1)[0] || "") && "vendeu depois do stop"].filter(Boolean) as string[],
  },
};

// O OS de mentira: um parceiro sem seguro e uma cliente com limpeza na sexta.
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

// Chase: a conversa parou e o Harvey escreve (ou não) o lembrete.
const CHASES: Array<{ nome: string; conversa: Fala[]; deveMandar: boolean }> = [
  {
    nome: "chase_link",
    deveMandar: true,
    conversa: [
      { papel: "cliente", texto: "how much is a deep clean for a 2 bed flat in E17, 1 bathroom" },
      { papel: "harvey", texto: "Hi there, I'm Harvey and I'll be looking after you. A 2 bed deep clean with 1 bathroom in E17 is £237, fixed. I have Thursday or Friday morning free, which suits you?" },
    ],
  },
  {
    nome: "chase_tchau",
    deveMandar: false,
    conversa: [
      { papel: "cliente", texto: "ok thanks, I'll think about it and come back to you" },
      { papel: "harvey", texto: "No worries, speak soon." },
      { papel: "cliente", texto: "stop messaging me please" },
      { papel: "harvey", texto: "Understood, I won't message again." },
    ],
  },
];

// "semvaga" só faz sentido com a capacidade ligada: roda quando pedido pelo nome.
const escolhidos = process.argv.slice(2).length ? process.argv.slice(2).filter((c) => c in CASOS) : Object.keys(CASOS).filter((c) => c !== "semvaga");
const cat = catalog();
let falhas = 0;
const relatorio: string[] = [];
for (const nome of escolhidos) {
  const caso = CASOS[nome];
  const conversa: Fala[] = caso.abertura ? [{ papel: "harvey", texto: caso.abertura }] : [];
  const ferramentas: string[] = [];
  let passou: string | null = null;
  let link = false;
  const linhas: string[] = [`\n=== ${nome}`];
  for (const msg of caso.cliente) {
    conversa.push(msg === "[image sent]" ? { papel: "cliente", texto: msg, midia: "https://example.test/doc.jpg" } : { papel: "cliente", texto: msg });
    linhas.push(`  👤 ${msg}`);
    const t0 = Date.now();
    const fotos = conversa.some((f) => f.midia) && !caso.quem ? [FOTO_TETO] : [];
    const r = await pensar(conversa, { telefone: "+447700900123", nomeNoWhatsApp: "Test", campanha: "teste", quem: caso.quem, sobreQuem: caso.sobre, contas: CONTAS, fotos }, site, cat);
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
  if (/get in on the day[^\n]*(letting agent|key safe|concierge)/i.test(textoHarvey)) problemas.push("pergunta de acesso com menu de opções");
  if ((textoHarvey.match(/(hi|hey|hello)( there)?,? I['’]m Harvey/gi) ?? []).length > 1) problemas.push("se apresentou duas vezes");
  if ((textoHarvey.match(/Harvey/g) ?? []).length > 1 && nome !== "bot") problemas.push("repetiu o nome");
  const primeira = conversa.find((f) => f.papel === "harvey")?.texto ?? "";
  if (nome !== "reclamacao" && nome !== "stop" && !caso.abertura && !/I['’]?m Harvey/i.test(primeira)) problemas.push("primeira resposta sem 'I'm Harvey'");
  if (/from Fixfy here/i.test(textoHarvey)) problemas.push("disse 'Harvey from Fixfy here'");
  // Dia livre só sai da agenda: oferecer dia sem get_available_dates é chute (handyman, pintura, ad_handyman em 07/10).
  if (caso.quem !== "cliente" && ofereceDia(textoHarvey) && !ferramentas.includes("get_available_dates")) problemas.push("ofereceu dia sem consultar a agenda");
  if (/\b(got you in|you're booked|booking is confirmed)\b/i.test(textoHarvey.split(/checkout\.stripe\.com|06913415/)[0])) problemas.push("disse que está reservado antes do link");
  if (problemas.length) falhas++;
  linhas.push(problemas.length ? `  ❌ ${problemas.join(" · ")}` : "  ✅ ok");
  console.log(linhas.join("\n"));
  relatorio.push(...linhas);
}
for (const c of CHASES.filter((c) => !process.argv.slice(2).length || process.argv.includes(c.nome))) {
  const r = await pensar(c.conversa, { telefone: "+447700900123", nomeNoWhatsApp: "Test", campanha: "teste", chase: 1, horasSemResposta: 1.2, contas: CONTAS }, site, cat);
  const ok = c.deveMandar ? !!r.resposta && r.resposta.length < 240 && !/I['’]m Harvey/.test(r.resposta) && !/£\d/.test(r.resposta) : !r.resposta;
  const linha = `\n=== ${c.nome}\n  🤖 ${r.resposta ?? "(nada: NO_CHASE)"}\n  ${ok ? "✅ ok" : "❌ chase errado"}`;
  console.log(linha);
  relatorio.push(linha);
  escolhidos.push(c.nome);
  if (!ok) falhas++;
}
console.log(`\n${escolhidos.length - falhas}/${escolhidos.length} passaram`);
writeFileSync(new URL("./ultima-bateria.txt", import.meta.url), relatorio.join("\n") + `\n\n${escolhidos.length - falhas}/${escolhidos.length} passaram\n`);
