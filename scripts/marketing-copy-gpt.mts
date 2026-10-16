/**
 * Reescreve a copy de marketing com a OpenAI e monta o deck para o dono aprovar.
 *
 *   npx tsx scripts/marketing-copy-gpt.mts               # tudo
 *   npx tsx scripts/marketing-copy-gpt.mts --so=week10   # só a campanha
 *   npx tsx scripts/marketing-copy-gpt.mts --so=resto    # nurture + agenda
 *
 * Nada aqui envia e-mail nem mexe no código: sai `.copy-deck/deck.json` (o que
 * volta para agenda.ts e lifecycle-templates.ts depois de aprovado) e
 * `.copy-deck/deck.html` (atual ao lado do novo).
 *
 * O modelo escreve, mas não decide o que é verdade. Cada peça passa por um
 * conferidor antes de entrar no deck: preço que não existe na tabela, serviço
 * fora da vitrine, cupom inventado, travessão ou depoimento fazem a peça
 * voltar para o modelo com o motivo, até duas vezes. Depoimento sai sempre:
 * as citações "Verified Fixfy customer" do rascunho antigo não eram de cliente
 * nenhum, e avaliação inventada é ilegal no UK (DMCC Act 2024).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AGENDA, type PecaDaAgenda } from "../src/lib/email-sequences/agenda";
import { NURTURE } from "../src/lib/email-sequences/lifecycle-templates";
import { CUPONS } from "../src/lib/marketing/cupons";
import type { Bloco } from "../src/lib/emails/campanha-layout";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const MODELO = process.env.COPY_MODEL || "gpt-5.5";
const SO = process.argv.find((a) => a.startsWith("--so="))?.slice(5);

/* ─────────────── O que é verdade (23/09/2026, conferido no site) ─────────────── */

const FATOS = `
FIXFY, London home services. Site: getfixfy.com, book online in about 2 minutes, see the price before booking.
WhatsApp and phone: 020 4538 4668. Prices include VAT.

THE SIX SERVICES WE SELL (nothing else may be offered or sold):
1. End of tenancy cleaning: studio £200, 1 bed £223, 2 bed £266, 3 bed £318, 4 bed £384, 5+ bed £451. Oven included.
2. Deep cleaning: studio £174, 1 bed £194, 2 bed £237, 3 bed £289, 4 bed £356, 5+ bed £422.
3. After builders cleaning: studio £204, 1 bed £227, 2 bed £269, 3 bed £322, 4 bed £388, 5+ bed £455.
   Cleaning prices include 1 bathroom; extra bathroom +£42 / +£52 / +£66. Add-ons: carpet clean £38 per room,
   fridge and freezer £43, balcony £57, outside windows £35. Products and equipment included.
   If anything is missed, free re-clean within 7 days.
4. Repairs (a skilled pro for small jobs around the home): half day (3.5h) £180, full day (7h) £329. Materials quoted separately.
5. Painting: touch-up £215, one room £450, full day £465.
6. Certificates: Gas Safety (CP12) £79, EICR (electrical) from £129, EPC from £95.

Rules of the offer: pay when you book, the price is fixed and never goes up on the day, free cancellation up to 48 hours before.
Every pro is vetted and insured.

NOT SOLD (never offer, never price, never imply we do it): boiler service, boiler repair, plumbing, electrician call-outs,
gutter clearing, carpentry, building work, appliance testing, "handyman" as a word, carpet cleaning as a standalone service.
Seasonal tips about these topics are fine as free advice, but the call to action must point to one of the six services.

NEVER: invent reviews, quotes, ratings, customer counts, "verified customer" lines, awards, response times you cannot prove,
or "a person always picks up". Never use the em dash character. British English. Short sentences. Warm, plain, a neighbour
not a salesman. Sign-off is handled by the layout ("Leo at Fixfy"), do not add a signature.
`.trim();

const PUBLICO = `
WHO READS THIS: people in London who asked Fixfy (mostly through Checkatrade) for a price on a home job in 2026 and mostly
did not book, plus a few hundred who did. Renters moving out, homeowners, some small landlords. They are busy, wary of
tradespeople who do not turn up or change the price, and they get a lot of promotional email. What converts them: a clear
fixed price, no hassle, trust, a reason to act now. Use their first name only where the layout provides it (do not write "Hi {name}").
`.trim();

const PRECOS_OK = new Set(
  [200, 223, 266, 318, 384, 451, 174, 194, 237, 289, 356, 422, 204, 227, 269, 322, 388, 455, 42, 52, 66, 38, 43, 57, 35, 180, 329, 215, 450, 465, 79, 129, 95, 20, 50, 100, 300]
    .map(String),
);
const CUPONS_OK = new Set([...CUPONS.map((c) => c.codigo), "WEEK10"]);
const PROIBIDO = [/boiler serv/i, /boiler repair/i, /\bhandyman\b/i, /gutter clear/i, /plumb(er|ing) (call|visit|service)/i, /verified (fixfy )?customer/i, /—/, /appliance test/i, /carpenter|carpentry/i];

type Doc = {
  id: string;
  grupo: "week10" | "whatsapp" | "nurture" | "agenda";
  briefing: string;
  atual: Record<string, unknown> | null;
  cupom?: string;
};

function conferir(doc: Doc, novo: Record<string, unknown>): string[] {
  const texto = JSON.stringify(novo);
  const erros: string[] = [];
  for (const re of PROIBIDO) if (re.test(texto)) erros.push(`contains forbidden pattern ${re}`);
  for (const m of texto.matchAll(/£\s?(\d+(?:\.\d+)?)/g)) if (!PRECOS_OK.has(m[1])) erros.push(`price £${m[1]} is not in the price list`);
  for (const m of texto.matchAll(/\b([A-Z]{3,}\d{2})\b/g)) if (!CUPONS_OK.has(m[1])) erros.push(`code ${m[1]} does not exist`);
  if (doc.cupom && !texto.includes(doc.cupom)) erros.push(`must mention the code ${doc.cupom}`);
  if (!doc.cupom && /\b(?:WEEK10|WELCOME10|[A-Z]{4,}1[05])\b/.test(texto) && doc.grupo === "agenda") erros.push("this edition has no coupon, do not mention one");
  if (/"tipo":"citacao"/.test(texto)) erros.push("quote blocks (testimonials) are not allowed");
  if (doc.grupo === "whatsapp") {
    const corpo = String(novo.corpo ?? "");
    if (corpo.length > 900) erros.push("WhatsApp body over 900 characters");
    if (!corpo.includes("{{1}}")) erros.push("WhatsApp body must start by greeting {{1}} (first name)");
    if (/\{\{[3-9]\}\}/.test(corpo)) erros.push("only {{1}} and {{2}} variables allowed");
  }
  return erros;
}

/* ─────────────── A chamada ─────────────── */

let tokensIn = 0;
let tokensOut = 0;

async function escrever(doc: Doc, formato: string, reclamacao?: string): Promise<Record<string, unknown>> {
  const instrucoes = `You are the senior direct-response copywriter for Fixfy. Rewrite marketing copy so it is friendlier, clearer and converts better for this exact audience, while staying 100% true to the facts.\n\nFACTS:\n${FATOS}\n\nAUDIENCE:\n${PUBLICO}\n\nReturn ONLY JSON in this shape:\n${formato}`;
  const entrada = [
    `Answer in JSON. PIECE: ${doc.id}`,
    `BRIEF: ${doc.briefing}`,
    doc.atual ? `CURRENT VERSION (improve it, keep its topic and purpose):\n${JSON.stringify(doc.atual, null, 2)}` : "No current version, write it from the brief.",
    reclamacao ? `YOUR PREVIOUS ATTEMPT WAS REJECTED BY THE FACT CHECKER: ${reclamacao}. Fix exactly that.` : "",
  ].join("\n\n");

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO, instructions: instrucoes, input: entrada, text: { format: { type: "json_object" } } }),
  });
  const j = (await r.json()) as { output_text?: string; output?: { content?: { text?: string }[] }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message: string } };
  if (!r.ok) throw new Error(`${doc.id}: ${j.error?.message ?? r.status}`);
  tokensIn += j.usage?.input_tokens ?? 0;
  tokensOut += j.usage?.output_tokens ?? 0;
  const texto = j.output_text ?? j.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("") ?? "";
  return JSON.parse(texto);
}

const FORMATO_EMAIL = `{"assunto": string (max 60 chars), "preheader": string (max 90), "etiqueta": string (1-3 words), "titulo": string (max 50), "blocos": [ {"tipo":"texto","html": string (plain sentences, <strong> allowed)} | {"tipo":"lista","titulo": string,"itens": string[] (3-5 items)} ], "cta": string (2-4 words)}`;
const FORMATO_WA = `{"corpo": string (WhatsApp template body, plain text, max 700 chars, starts greeting {{1}}, uses {{2}} for the discount code, line breaks allowed, max 2 emojis), "botao": string (URL button label, max 25 chars)}`;

async function comConferencia(doc: Doc, formato: string): Promise<{ novo: Record<string, unknown>; avisos: string[] }> {
  let reclamacao: string | undefined;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const novo = await escrever(doc, formato, reclamacao);
    const erros = conferir(doc, novo);
    if (!erros.length) return { novo, avisos: [] };
    reclamacao = erros.join("; ");
    if (tentativa === 2) return { novo, avisos: erros };
  }
  throw new Error("inalcançável");
}

/* ─────────────── As peças ─────────────── */

const semCitacao = (blocos: Bloco[]) => blocos;

const WEEK10: Doc[] = [
  {
    id: "week10_email_os_dois",
    grupo: "week10",
    cupom: "WEEK10",
    atual: null,
    briefing: "Launch email for people we ALSO message on WhatsApp a few hours later. Warm, personal, like a note from Leo. Reason to write now: we have launched fixed-price cleaning in London and want to thank people who got in touch before. Offer: 10% off any of the six services with code WEEK10, valid until Sunday 27 September at midnight. Lead with end of tenancy and deep cleaning prices (from £200 / from £174), mention repairs, painting and certificates in one line. Make the deadline clear but not pushy.",
  },
  {
    id: "week10_email_so_email",
    grupo: "week10",
    cupom: "WEEK10",
    atual: null,
    briefing: "Direct offer email for people we only have an email for. Straight to the point in the first line: 10% off with code WEEK10 until Sunday 27 September at midnight, on any of the six services. Show 3 headline prices in a list. One short trust paragraph (fixed price, vetted and insured, free re-clean within 7 days).",
  },
  {
    id: "week10_email_lembrete",
    grupo: "week10",
    cupom: "WEEK10",
    atual: null,
    briefing: "Saturday 26 September reminder for people who did not click: the 10% code WEEK10 ends tomorrow, Sunday, at midnight. Very short, friendly, 2 short paragraphs and a list of 3 prices. Subject should create gentle urgency.",
  },
];

const WHATSAPP: Doc[] = [
  {
    id: "wa_week10_followup",
    grupo: "whatsapp",
    cupom: "{{2}}",
    atual: null,
    briefing: "WhatsApp follow-up sent 4 hours after the launch email to the same person. Refer to it naturally ('we sent you a quick email earlier'). Warm and short, like a message from a local business you know. Offer: 10% off with code {{2}} until Sunday at midnight. Mention end of tenancy from £200 and deep clean from £174. Say they can reply here with any question. No link in the body (there is a button).",
  },
  {
    id: "wa_week10_offer",
    grupo: "whatsapp",
    cupom: "{{2}}",
    atual: null,
    briefing: "WhatsApp message for people we only have a phone number for. They asked Fixfy for a price earlier this year. Direct offer: fixed-price cleaning across London, end of tenancy from £200, deep clean from £174, after builders from £204, and 10% off with code {{2}} until Sunday at midnight. Say they can reply here with any question. No link in the body (there is a button).",
  },
];

const nurtureDocs: Doc[] = NURTURE.map((p, i) => ({
  id: `nurture_${i + 1}_${p.key}`,
  grupo: "nurture",
  cupom: p.cupom,
  atual: { ...p, blocos: semCitacao(p.blocos) },
  briefing: `Email ${i + 1} of 10 in the 30-day sequence for people who asked for a price and did not book (days 0,1,2,4,6,8,11,14,21,30). Keep its role in the sequence. ${p.cupom ? `It carries the code ${p.cupom} (10% off first job).` : "No discount code in this one."} Replace any testimonial with a concrete, true fact about how we work.`,
}));

const agendaDocs: Doc[] = AGENDA.slice(0, 29).map((p: PecaDaAgenda) => ({
  id: `agenda_${p.n}_${p.key}`,
  grupo: "agenda",
  cupom: p.cupom,
  atual: { ...p },
  briefing: `Twice-weekly newsletter edition ${p.n}, sent around ${dataDe(p.n)}, label "${p.etiqueta}". Two thirds of editions are genuinely useful home tips, one third carry an offer. ${p.cupom ? `This one carries the code ${p.cupom}: check cupons.ts meaning, describe it as ${descreverCupom(p.cupom)}.` : "This one has NO code: pure value, soft call to action to one of the six services."} If the current topic sells something we no longer do (boiler service, handyman lists, gutters, radiators, carpet replacement), keep the seasonal tip as free advice and point the call to action to the closest of the six services.`,
}));

function dataDe(n: number): string {
  const d = new Date(Date.UTC(2026, 8, 28) + (n - 1) * 3.5 * 86400000);
  return d.toISOString().slice(0, 10);
}
function descreverCupom(codigo: string): string {
  const c = CUPONS.find((x) => x.codigo === codigo);
  if (!c) return codigo;
  const valor = c.percentual ? `${c.percentual}% off` : `£${(c.pence ?? 0) / 100} off`;
  return `${valor}${c.minimoPence ? ` on orders over £${c.minimoPence / 100}` : ""}, valid until ${c.expiraEm}, name "${c.nome}"`;
}

/* ─────────────── Roda ─────────────── */

const todos: Array<{ doc: Doc; formato: string }> = [
  ...(SO === "resto" ? [] : WEEK10.map((doc) => ({ doc, formato: FORMATO_EMAIL }))),
  ...(SO === "resto" ? [] : WHATSAPP.map((doc) => ({ doc, formato: FORMATO_WA }))),
  ...(SO === "week10" ? [] : [...nurtureDocs, ...agendaDocs].map((doc) => ({ doc, formato: FORMATO_EMAIL }))),
];

mkdirSync(".copy-deck", { recursive: true });
const resultado: Array<{ id: string; grupo: string; atual: unknown; novo: unknown; avisos: string[] }> = [];

const LOTE = 5;
for (let i = 0; i < todos.length; i += LOTE) {
  const lote = await Promise.all(
    todos.slice(i, i + LOTE).map(async ({ doc, formato }) => {
      const { novo, avisos } = await comConferencia(doc, formato);
      process.stdout.write(`${avisos.length ? "⚠" : "✓"} ${doc.id}\n`);
      return { id: doc.id, grupo: doc.grupo, atual: doc.atual, novo, avisos };
    }),
  );
  resultado.push(...lote);
  writeFileSync(`.copy-deck/${SO ?? "deck"}.json`, JSON.stringify({ modelo: MODELO, geradoEm: new Date().toISOString(), tokensIn, tokensOut, pecas: resultado }, null, 2));
}

console.log(`\n${resultado.length} peças, ${resultado.filter((r) => r.avisos.length).length} com aviso. Tokens: ${tokensIn} in / ${tokensOut} out.`);
