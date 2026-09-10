import { test } from "node:test";
import assert from "node:assert/strict";
import { chamarOpenAI, SemSaldoOpenAI } from "./openai-com-retry";

/** Troca o fetch global por um roteiro de respostas, e conta as chamadas. */
function comFetch(roteiro: Array<Response | Error>) {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = (async () => {
    const passo = roteiro[Math.min(chamadas, roteiro.length - 1)]!;
    chamadas++;
    if (passo instanceof Error) throw passo;
    return passo.clone();
  }) as typeof fetch;
  return { restaurar: () => { globalThis.fetch = original; }, quantas: () => chamadas };
}

const resposta = (status: number, corpo = "{}", headers: Record<string, string> = {}) =>
  new Response(corpo, { status, headers });

test("sucesso na primeira não tenta de novo", async () => {
  const f = comFetch([resposta(200, '{"ok":true}')]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 3 });
    assert.equal(r.status, 200);
    assert.equal(f.quantas(), 1);
  } finally { f.restaurar(); }
});

test("429 de pico é tentado de novo e passa", async () => {
  const f = comFetch([resposta(429, '{"error":{"type":"rate_limit_exceeded"}}'), resposta(200)]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 3 });
    assert.equal(r.status, 200);
    assert.equal(f.quantas(), 2, "tropeçou uma vez e seguiu");
  } finally { f.restaurar(); }
});

test("429 SEM SALDO falha na hora, sem queimar tentativa", async () => {
  const f = comFetch([resposta(429, '{"error":{"type":"insufficient_quota","message":"You have no credits remaining"}}')]);
  try {
    await assert.rejects(
      () => chamarOpenAI("https://x", {}, { tentativas: 3 }),
      (e: Error) => e instanceof SemSaldoOpenAI && /sem saldo/i.test(e.message),
    );
    assert.equal(f.quantas(), 1, "esperar não faz saldo aparecer");
  } finally { f.restaurar(); }
});

test("500 também é tentado de novo", async () => {
  const f = comFetch([resposta(503), resposta(503), resposta(200)]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 3 });
    assert.equal(r.status, 200);
    assert.equal(f.quantas(), 3);
  } finally { f.restaurar(); }
});

test("400 não é tentado de novo: o pedido está errado, repetir não conserta", async () => {
  const f = comFetch([resposta(400, '{"error":{"message":"bad request"}}')]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 3 });
    assert.equal(r.status, 400);
    assert.equal(f.quantas(), 1);
  } finally { f.restaurar(); }
});

test("esgotadas as tentativas, devolve a última resposta em vez de explodir", async () => {
  const f = comFetch([resposta(429, '{"error":{"type":"rate_limit_exceeded"}}')]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 2 });
    assert.equal(r.status, 429, "quem chamou decide o que fazer com o 429 final");
    assert.equal(f.quantas(), 2);
  } finally { f.restaurar(); }
});

test("rede caindo é tentada de novo, e a última propaga", async () => {
  const f = comFetch([new Error("ECONNRESET")]);
  try {
    await assert.rejects(() => chamarOpenAI("https://x", {}, { tentativas: 2 }), /ECONNRESET/);
    assert.equal(f.quantas(), 2);
  } finally { f.restaurar(); }
});

test("o corpo continua legível para quem chamou", async () => {
  const f = comFetch([resposta(429, '{"error":{"type":"rate_limit_exceeded"}}'), resposta(200, '{"choices":[]}')]);
  try {
    const r = await chamarOpenAI("https://x", {}, { tentativas: 3 });
    assert.deepEqual(await r.json(), { choices: [] });
  } finally { f.restaurar(); }
});
