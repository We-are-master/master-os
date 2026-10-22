import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chaveDoPedidoDeDatas, classificarMensagem, completarComDatas, corpoDoLanceIncompleto, faltamDatas, htmlDoPedidoDeDatas, lerClassificacaoJson, lerLanceIncompleto,
  normalizarDatas, notasDoLancePorEmail, pedirDatasAoParceiro, SISTEMA_CLASSIFICACAO, type Classificacao,
} from "./lances-por-email";
import { parseBidProposalFromNotes } from "./quote-bid-payload";
import { bancoFalso } from "@/lib/processo/banco-falso-teste";

const lance = (o: Partial<Classificacao> = {}): Classificacao => ({ tipo: "bid", total: 300, labour: 300, materials: null, duracao: null, notas: "Paint the hallway", resposta: null, datas: [], ...o });

describe("partner bid by email: two date options (stage 3)", () => {
  it("reads up to two different valid dates", () => {
    assert.deepEqual(normalizarDatas(["2026-10-28", "2026-10-28", "30/10/2026", "2026-11-02"]), ["2026-10-28", "2026-10-30"]);
    assert.deepEqual(normalizarDatas(["next week", 5]), []);
    assert.deepEqual(normalizarDatas(undefined), []);
    const c = lerClassificacaoJson(JSON.stringify({ type: "bid", total: 300, dates: ["2026-10-28", "2026-10-30"] }))!;
    assert.deepEqual(c.datas, ["2026-10-28", "2026-10-30"]);
  });

  it("a bid with fewer than two dates is incomplete", () => {
    assert.equal(faltamDatas(lance()), true);
    assert.equal(faltamDatas(lance({ datas: ["2026-10-28"] })), true);
    assert.equal(faltamDatas(lance({ datas: ["2026-10-28", "2026-10-30"] })), false);
  });

  it("the held bid round-trips and is completed by a reply with only dates", () => {
    const guardado = lerLanceIncompleto(corpoDoLanceIncompleto(lance({ datas: ["2026-10-28"] }), "£300 for the hallway"))!;
    assert.equal(guardado.c.total, 300);
    assert.equal(lerLanceIncompleto("plain text"), null);
    const soDatas = lance({ tipo: "answer", total: null, labour: null, datas: ["2026-10-30"] });
    const junto = completarComDatas(guardado.c, soDatas);
    assert.equal(junto.total, 300);
    assert.deepEqual(junto.datas, ["2026-10-30", "2026-10-28"]);
    assert.equal(faltamDatas(junto), false);
    // A new price in the reply wins (revised bid).
    assert.equal(completarComDatas(guardado.c, lance({ total: 350, datas: ["2026-10-30"] })).total, 350);
  });

  it("the dates go into the BID_JSON like the portal bid", () => {
    const p = parseBidProposalFromNotes(notasDoLancePorEmail(lance({ datas: ["2026-10-28", "2026-10-30"] }), { quando: "2026-10-22 10:00", textoDoParceiro: "x" }));
    assert.equal(p?.start_date_option_1, "2026-10-28");
    assert.equal(p?.start_date_option_2, "2026-10-30");
    const semDatas = parseBidProposalFromNotes(notasDoLancePorEmail(lance(), { quando: "2026-10-22 10:00", textoDoParceiro: "x" }));
    assert.equal(semDatas?.start_date_option_1, undefined);
  });

  it("outside v2 the model is asked exactly as before and dates are dropped", async () => {
    let sistema = "";
    const c = await classificarMensagem({ referencia: "Q-1", escopo: null, nossaUltima: null, texto: "£300" }, async (s) => {
      sistema = s;
      return JSON.stringify({ type: "bid", total: 300, dates: ["2026-10-28", "2026-10-30"] });
    });
    assert.equal(sistema, SISTEMA_CLASSIFICACAO);
    assert.deepEqual(c?.datas, []);
    const v2 = await classificarMensagem({ referencia: "Q-1", escopo: null, nossaUltima: null, texto: "£300", comDatas: true, hoje: "2026-10-22" }, async (s, u) => {
      assert.match(s, /"dates"/);
      assert.match(u, /TODAY is 2026-10-22/);
      return JSON.stringify({ type: "bid", total: 300, dates: ["2026-10-28", "2026-10-30"] });
    });
    assert.deepEqual(v2?.datas, ["2026-10-28", "2026-10-30"]);
  });

  it("asks the partner for two dates only once", async () => {
    const { sb } = bancoFalso();
    let enviados = 0;
    const enviar = async () => { enviados++; return { ok: true }; };
    const p = { quoteId: "q1", partnerId: "p1", referencia: "Q-1", total: 300, ticketId: 10, email: "p@x.com" };
    assert.equal(await pedirDatasAoParceiro(sb, p, enviar), "pediu");
    assert.equal(await pedirDatasAoParceiro(sb, p, enviar), "ja_pediu");
    assert.equal(enviados, 1);
    assert.equal(chaveDoPedidoDeDatas("q1", "p1"), "bid-datas:q1:p1");
  });

  it("a failed ask frees the key for the next round", async () => {
    const { sb } = bancoFalso();
    const p = { quoteId: "q1", partnerId: "p1", referencia: "Q-1", total: 300, ticketId: 10, email: "p@x.com" };
    assert.equal(await pedirDatasAoParceiro(sb, p, async () => ({ ok: false, error: "422" })), "falhou");
    assert.equal(await pedirDatasAoParceiro(sb, p, async () => ({ ok: true })), "pediu");
  });

  it("the ask is plain English, no em dashes", () => {
    const h = htmlDoPedidoDeDatas("Q-1", 300);
    assert.match(h, /two dates/);
    assert.doesNotMatch(h, /—/);
  });
});
