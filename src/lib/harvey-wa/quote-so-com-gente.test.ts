/**
 * Cotação só com gente e conversa do Harvey no Action Required (dono, 09/11/2026).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conversaVaiParaAFila, TAG_AR_DA_CONVERSA } from "./zendesk-wa";
import { ACTION_REQUIRED_FIELD_ID, ACTION_REQUIRED_NO, ACTION_REQUIRED_YES } from "@/lib/fila-de-acao";
import { planoDoPedido, planoSoComGente, proximaAcaoDoNeedsQuote } from "@/lib/processo/b2b-humano";
import { BUSCA_B2B_COTAR } from "@/lib/processo/b2b-cotar";

const campoAr = (value: string | null) => [{ id: ACTION_REQUIRED_FIELD_ID, value }];

describe("conversa do Harvey na Action Required", () => {
  it("cliente escreveu, conversa nova: entra", () => {
    assert.equal(conversaVaiParaAFila({ tags: ["harvey_ai", "harvey_wa"], custom_fields: campoAr(null) }, "reply_awaiting"), true);
  });
  it("conversa que nasceu no WhatsApp, sem lead anterior, também entra", () => {
    assert.equal(conversaVaiParaAFila({ tags: ["customer"] }, "reply_awaiting"), true);
  });
  it("mensagem nossa não liga nada", () => {
    assert.equal(conversaVaiParaAFila({ tags: [] }, "reply_replied"), false);
  });
  it("uma vez só: com o carimbo, nunca de novo", () => {
    assert.equal(conversaVaiParaAFila({ tags: [TAG_AR_DA_CONVERSA] }, "reply_awaiting"), false);
  });
  it("quem pôs No não vê a conversa voltar", () => {
    assert.equal(conversaVaiParaAFila({ tags: ["lead_mirrored"], custom_fields: campoAr(ACTION_REQUIRED_NO) }, "reply_awaiting"), false);
  });
  it("já está com Yes: nada a fazer", () => {
    assert.equal(conversaVaiParaAFila({ tags: [], custom_fields: campoAr(ACTION_REQUIRED_YES) }, "reply_awaiting"), false);
  });
  it("parceiro e harvey_off ficam fora", () => {
    assert.equal(conversaVaiParaAFila({ tags: ["partner"] }, "reply_awaiting"), false);
    assert.equal(conversaVaiParaAFila({ tags: ["harvey_off"] }, "reply_awaiting"), false);
  });
});

describe("pedido de quote só com gente", () => {
  it("nada sai sozinho: sem convite, sem transmitir, sem pergunta, sem aviso", () => {
    const p = planoSoComGente(planoDoPedido(null));
    assert.equal(p.revisaoHumana, true);
    assert.equal(p.convidarParceiros, false);
    assert.equal(p.transmitir, false);
    assert.equal(p.pedirInfo, false);
    assert.equal(p.avisoSempre, false);
  });
  it("trabalho por hora de conta B2B segue a regra de antes", () => {
    assert.equal(planoSoComGente(planoDoPedido(null)).aceitarHora, planoDoPedido(null).aceitarHora);
  });
  it("a linha do Action Required manda para a macro", () => {
    assert.match(proximaAcaoDoNeedsQuote("QT-2026-1300"), /^Needs quote: request registered as QT-2026-1300\..*Get partner quotes/);
    assert.match(proximaAcaoDoNeedsQuote(null), /request received/);
  });
  it("a macro do e-mail não pega conversa do WhatsApp", () => {
    assert.match(BUSCA_B2B_COTAR, /-tags:harvey_wa/);
    assert.match(BUSCA_B2B_COTAR, /-tags:harvey-wa/);
  });
});
