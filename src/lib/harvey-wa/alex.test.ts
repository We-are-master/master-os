/**
 * Alex, B2C Sales (dono, 10/11/2026). Sem rede: o modelo e o banco são um fetch de mentira
 * que responde o roteiro do teste e recusa qualquer outro endereço.
 *
 *   porta desligada → mesmas ferramentas e mesmo prompt de hoje
 *   HARVEY_ALEX=1 sem HARVEY_DONO_POR_AGENTE=1 → Alex desligado
 *   ligada → Harvey sem venda e com pass_to_alex; Alex só com as de venda
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { agenteDaVez, alexLigado, conversaDoAlex, FERRAMENTAS_DO_ALEX, motivoDaPassagemParaAlex } from "./alex";
import { ferramentasDoPerfil, paraOpenAiDoAlex, pensar, type Contas, type Fala } from "./cerebro";
import { promptDoAlex, promptDoHarvey, secoesDo, SECOES_ALEX, TRIAGEM_COM_ALEX } from "./prompt";
import { motivoDaDevolucao } from "./equipe-dona";
import type { MensagemSc } from "./sunshine";
import Module from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** O motor importa "server-only" (só existe no Next): fora dele, um módulo vazio no lugar. */
async function motor() {
  const vazio = join(mkdtempSync(join(tmpdir(), "server-only-")), "index.js");
  writeFileSync(vazio, "module.exports = {};");
  const m = Module as unknown as { _resolveFilename: (pedido: string, ...resto: unknown[]) => string };
  const original = m._resolveFilename;
  m._resolveFilename = (pedido, ...resto) => (pedido === "server-only" ? vazio : original(pedido, ...resto));
  try {
    return await import("./motor");
  } finally {
    m._resolveFilename = original;
  }
}

const nomes = (l: readonly { function: { name: string } }[]) => l.map((f) => f.function.name);
const LIGADO = { HARVEY_ALEX: "1", HARVEY_DONO_POR_AGENTE: "1" };

describe("portas", () => {
  it("o Alex só liga com as duas portas", () => {
    assert.equal(alexLigado({}), false);
    assert.equal(alexLigado({ HARVEY_ALEX: "0", HARVEY_DONO_POR_AGENTE: "1" }), false);
    assert.equal(alexLigado(LIGADO), true);
  });
  it("HARVEY_ALEX=1 sem o dono por agente: desligado e avisa uma vez só", () => {
    const avisos: unknown[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void avisos.push(a);
    try {
      assert.equal(alexLigado({ HARVEY_ALEX: "1" }), false);
      assert.equal(alexLigado({ HARVEY_ALEX: "1" }), false);
    } finally {
      console.warn = warn;
    }
    assert.equal(avisos.length, 1);
  });
});

describe("dono da vez", () => {
  it("só é o Alex com a porta ligada, a marca e quem não é parceiro", () => {
    assert.equal(agenteDaVez({ estado: "harvey", motivo_passagem: "[agent:alex]" }, "cliente", true), "alex");
    assert.equal(agenteDaVez({ estado: "harvey", motivo_passagem: "[agent:alex]" }, "cliente", false), "harvey");
    assert.equal(agenteDaVez({ estado: "harvey", motivo_passagem: "[agent:alex]" }, "parceiro", true), "harvey");
    assert.equal(agenteDaVez({ estado: "harvey", motivo_passagem: null }, "cliente", true), "harvey");
    assert.equal(agenteDaVez(null, null, true), "harvey");
    // Com a equipe, ninguém responde (o motor já para antes); a marca fica para o Give back.
    assert.equal(agenteDaVez({ estado: "equipe", motivo_passagem: "Ana took over [agent:alex]" }, "cliente", true), "harvey");
    assert.equal(conversaDoAlex("Ana took over [agent:alex]", true), true);
    assert.equal(conversaDoAlex("Ana took over [agent:alex]", false), false);
  });
  it("a passagem ao Alex guarda a marca do Give back (a trava de 3h continua sabendo)", () => {
    const devolvida = motivoDaDevolucao("Ana", new Date("2026-11-10T10:00:00Z"));
    assert.equal(motivoDaPassagemParaAlex(devolvida), `${devolvida} [agent:alex]`);
    assert.equal(motivoDaPassagemParaAlex(null), "[agent:alex]");
  });
});

describe("ferramentas por perfil", () => {
  const todas = ferramentasDoPerfil({ parceiro: false, alex: false });
  it("porta desligada: a lista de sempre, inclusive pedindo o perfil do Alex", () => {
    assert.deepEqual(nomes(ferramentasDoPerfil({ parceiro: false, perfil: "alex", alex: false })), nomes(todas));
    assert.ok(nomes(todas).includes("create_payment_link") && nomes(todas).includes("accept_quote") && !nomes(todas).includes("pass_to_alex"));
  });
  it("Alex: só as de venda, sem accept_quote nem book_team_price", () => {
    const alex = nomes(ferramentasDoPerfil({ parceiro: false, perfil: "alex", alex: true }));
    assert.deepEqual([...alex].sort(), [...FERRAMENTAS_DO_ALEX].sort());
    const passagem = ferramentasDoPerfil({ parceiro: false, perfil: "alex", alex: true }).find((f) => f.function.name === "hand_off_to_team");
    assert.match(passagem!.function.description, /you book catalogue jobs yourself/);
  });
  it("Harvey com o Alex: sem preço, agenda, link e accept_quote; com pass_to_alex", () => {
    const h = nomes(ferramentasDoPerfil({ parceiro: false, alex: true }));
    for (const fora of ["get_quote", "check_discount", "get_available_dates", "create_payment_link", "accept_quote"]) assert.ok(!h.includes(fora), fora);
    for (const fica of ["pass_to_alex", "hand_off_to_team", "request_quote", "get_quote_status", "get_my_bookings", "book_team_price"]) assert.ok(h.includes(fica), fica);
  });
  it("parceiro: igual, com ou sem o Alex", () => {
    assert.deepEqual(nomes(ferramentasDoPerfil({ parceiro: true, alex: true })), nomes(ferramentasDoPerfil({ parceiro: true, alex: false })));
  });
});

describe("falas e prompt", () => {
  const msg = (metadata?: Record<string, unknown>, displayName = "Harvey"): MensagemSc => ({ id: "m", received: "2026-11-10T10:00:00Z", author: { type: "business", displayName }, content: { type: "text", text: "Hi" }, metadata });
  it("paraFalas: sem metadata agente, a fala sai igual a hoje", async () => {
    const { paraFalas } = await motor();
    assert.deepEqual(paraFalas([msg({ harvey: true })]), [{ papel: "harvey", texto: "Hi" }]);
    assert.deepEqual(paraFalas([msg({ harvey: true, agente: "alex" }, "Alex")]), [{ papel: "harvey", texto: "Hi", agente: "alex" }]);
  });
  it("o Alex vê o que o Harvey escreveu marcado, e o dele sem marca", () => {
    const c: Fala[] = [{ papel: "harvey", texto: "a" }, { papel: "harvey", texto: "b", agente: "alex" }, { papel: "cliente", texto: "c" }];
    assert.deepEqual(paraOpenAiDoAlex(c).map((f) => f.texto), ["[Harvey wrote] a", "b", "c"]);
  });
  it("prompt do Alex: se apresenta como Alex da equipe, regras de preço, sem travessão", () => {
    const p = promptDoAlex({});
    assert.match(p, /I'm Alex, from the Fixfy team/);
    assert.match(p, /call out is £72 and covers the first hour/);
    assert.match(p, /half day \(£180/);
    assert.match(p, /full day \(£329/);
    assert.match(p, /accepted only through the accept link/);
    assert.doesNotMatch(p, /I'm Harvey/);
    for (const s of SECOES_ALEX) assert.doesNotMatch(s.texto, /[—–]/, s.id);
    assert.doesNotMatch(TRIAGEM_COM_ALEX, /[—–]/);
    assert.equal(secoesDo("alex"), SECOES_ALEX);
  });
  it("o prompt do Harvey de sempre não fala do Alex", () => {
    assert.doesNotMatch(promptDoHarvey({}), /Alex/);
  });
});

/* ── O turno inteiro (pensar), com o modelo de mentira ─────────────────────────── */

type Pedido = { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown }> };
const fetchOriginal = globalThis.fetch;
const envOriginal = { ...process.env };
let pedidos: Pedido[] = [];
let roteiro: Array<Record<string, unknown>> = [];

function respostaDoModelo(m: Record<string, unknown>) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, ...m } }] }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  pedidos = [];
  roteiro = [];
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://banco.teste", SUPABASE_SERVICE_ROLE_KEY: "chave", OPENAI_API_KEY: "chave", HARVEY_SEM_EDICOES: "1" });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith("https://banco.teste/")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    if (u === "https://api.openai.com/v1/chat/completions") {
      pedidos.push(JSON.parse(String(init?.body)));
      const proximo = roteiro.shift();
      if (!proximo) throw new Error("o roteiro do modelo acabou");
      return respostaDoModelo(proximo);
    }
    throw new Error(`rede proibida no teste: ${u}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k];
  Object.assign(process.env, envOriginal);
});

const site = async () => ({ status: 200, data: {} });
const chamada = (name: string, args: Record<string, unknown> = {}) => ({ tool_calls: [{ id: "t1", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const conversa: Fala[] = [
  { papel: "cliente", texto: "hi, need two shelves up in E17" },
  { papel: "harvey", texto: "Hi there, I'm Harvey and I'll be looking after you. Plasterboard or brick walls?" },
  { papel: "cliente", texto: "plasterboard. how much?" },
];
const contas = (aceites: unknown[]): Contas => ({ reservas: async () => ({ reservas: [] }), aceitarCotacao: async (d) => (aceites.push(d), { ok: true }) });

describe("o turno com o modelo de mentira", () => {
  it("porta DESLIGADA: o modelo recebe a lista e o prompt de sempre, e pass_to_alex não existe", async () => {
    delete process.env.HARVEY_ALEX;
    delete process.env.HARVEY_DONO_POR_AGENTE;
    roteiro = [chamada("pass_to_alex", { summary: "x" }), { content: "Plasterboard is fine. What day suits you?" }];
    const r = await pensar(conversa, { telefone: null, nomeNoWhatsApp: null, quem: "novo", contas: contas([]), perfil: "alex" }, site, {});
    assert.deepEqual(nomes(pedidos[0].tools), nomes(ferramentasDoPerfil({ parceiro: false, alex: false })));
    const sistema = String(pedidos[0].messages[0].content);
    assert.match(sistema, /^You are Harvey from Fixfy/);
    assert.doesNotMatch(sistema, /Alex/);
    assert.equal(r.passarParaAlex ?? null, null);
    assert.match(JSON.stringify(pedidos[1].messages.at(-1)), /unknown tool pass_to_alex/);
  });

  it("porta LIGADA: o Harvey passa para o Alex com a linha humana", async () => {
    Object.assign(process.env, LIGADO);
    roteiro = [chamada("pass_to_alex", { summary: "Handyman: two shelves on plasterboard, E17" }), { content: "Lovely, I'll get Alex from our bookings team to sort this with you." }];
    const r = await pensar(conversa, { telefone: null, nomeNoWhatsApp: null, quem: "novo", contas: contas([]) }, site, {});
    assert.ok(nomes(pedidos[0].tools).includes("pass_to_alex"));
    assert.ok(!nomes(pedidos[0].tools).includes("create_payment_link"));
    assert.match(String(pedidos[0].messages[0].content), /Sales are Alex's now/);
    assert.deepEqual(r.passarParaAlex, { resumo: "Handyman: two shelves on plasterboard, E17" });
    assert.equal(r.passarParaEquipe, null);
    assert.equal(r.resposta, "Lovely, I'll get Alex from our bookings team to sort this with you.");
  });

  it("porta LIGADA: o Alex se apresenta uma vez, vê o Harvey marcado e não aceita quote por texto", async () => {
    Object.assign(process.env, LIGADO);
    const aceites: unknown[] = [];
    roteiro = [chamada("accept_quote", { start_date: "none" }), { content: "That's £72 for the call out, covering the first hour. Shall I get that booked in?" }];
    const r = await pensar(conversa, { telefone: null, nomeNoWhatsApp: null, quem: "novo", contas: contas(aceites), perfil: "alex" }, site, {});
    assert.deepEqual([...nomes(pedidos[0].tools)].sort(), [...FERRAMENTAS_DO_ALEX].sort());
    assert.match(String(pedidos[0].messages[0].content), /^You are Alex from Fixfy/);
    assert.match(String(pedidos[0].messages[2].content), /^\[Harvey wrote\] Hi there, I'm Harvey/);
    assert.match(JSON.stringify(pedidos[1].messages.at(-1)), /unknown tool accept_quote/);
    assert.equal(aceites.length, 0, "accept_quote por texto não roda");
    assert.equal(r.resposta, "Hi, I'm Alex, from the Fixfy team. That's £72 for the call out, covering the first hour. Shall I get that booked in?");
  });

  it("porta LIGADA: depois da primeira fala do Alex, nada de se apresentar de novo", async () => {
    Object.assign(process.env, LIGADO);
    roteiro = [{ content: "Hi, I'm Alex, from the Fixfy team. What's the full address with postcode?" }];
    const c: Fala[] = [...conversa, { papel: "harvey", texto: "Hi, I'm Alex, from the Fixfy team. That's £72.", agente: "alex" }, { papel: "cliente", texto: "ok book it" }];
    const r = await pensar(c, { telefone: null, nomeNoWhatsApp: null, quem: "novo", contas: contas([]), perfil: "alex" }, site, {});
    assert.equal(r.resposta, "What's the full address with postcode?");
  });
});
