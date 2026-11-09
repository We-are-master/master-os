/**
 * Lembrete de véspera pelo 07 da operação (dono, 09/11/2026).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { canalDoLembrete24h, operacaoProntaParaLembrete, textoDoLembrete } from "./lembrete-pela-operacao";

const guardado = { ...process.env };
afterEach(() => { process.env = { ...guardado }; });

describe("canal do lembrete de véspera", () => {
  it("padrão é o 07 da operação", () => {
    delete process.env.LEMBRETE_24H_CANAL;
    assert.equal(canalDoLembrete24h(), "operacao");
  });
  it("zendesk volta ao template de antes", () => {
    process.env.LEMBRETE_24H_CANAL = "zendesk";
    assert.equal(canalDoLembrete24h(), "zendesk");
  });
  it("sem uazapi não manda e diz o que falta", () => {
    process.env.WHATSAPP_OPS_PROVIDER = "meta";
    assert.match(String(operacaoProntaParaLembrete()), /uazapi/);
  });
  it("com uazapi e token está pronto", () => {
    process.env.WHATSAPP_OPS_PROVIDER = "uazapi";
    process.env.UAZAPI_OPS_TOKEN = "tok";
    assert.equal(operacaoProntaParaLembrete(), null);
  });
});

describe("texto do lembrete", () => {
  const t = textoDoLembrete({ nome: "Sarah", data: "Tuesday 10 November", janela: "9am to 12pm", endereco: "12 Acacia Road, NW1 4AB" });
  it("diz dia, janela e endereço", () => {
    assert.match(t, /Hi Sarah/);
    assert.match(t, /tomorrow, Tuesday 10 November/);
    assert.match(t, /9am to 12pm at 12 Acacia Road, NW1 4AB/);
  });
  it("sem travessão", () => assert.doesNotMatch(t, /[—–]/));
});
