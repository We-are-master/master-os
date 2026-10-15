import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ESCOPO_PRECISA_DE_GENTE, ESPERANDO_ESCOPO, escopoDoLance, htmlDaPergunta, lerMarcaDeEspera, lerRespostaDoParceiro,
  lerRespostaDoParceiroJson, lerVerificacaoDeEscopo, marcaDeEscopo, marcaDeEspera, notasComNovoValor,
  passoDepoisDaResposta, pedidoDoCliente, respostaDoParceiro, verificarEscopoDoLance,
} from "./quote-lance-escopo";
import { lerPayloadDoLance } from "./quote-email-cliente";

/** O caso real: QT-2026-1166, ticket #51197. */
const PEDIDO_1166 = pedidoDoCliente(
  "Repair door frames chewed by the dog",
  [
    { author_id: 7, public: true, body: "The dog chewed two door frames. I'd like them restored with proper timber, not just filler." },
    { author_id: 99, public: false, body: "internal: partner invited" },
    { author_id: 7, public: true, body: "Just to repeat, proper timber please, not just filler." },
  ],
  7,
);
const NOTAS_1166 =
  'BID_JSON:{"labour_cost":180,"materials_cost":20,"labour_description":"Fill deep indentations using wood filler, sand and repaint","materials_description":"Wood filler, paint"}\nThanks';
const RESPOSTA_DIVERGE = JSON.stringify({
  diverge: true,
  motivo: "Customer asked twice for proper timber, not filler — the bid uses wood filler.",
  pergunta: "The customer asked for the frames to be restored with proper timber, not filler — your bid says wood filler. Does your price cover timber repair, or can you send a revised price?",
});

describe("escopo do lance: verificar contra o pedido", () => {
  it("o pedido junta o scope da quote e só o que o cliente escreveu em público", () => {
    assert.match(PEDIDO_1166, /^Quote scope: Repair door frames/);
    assert.match(PEDIDO_1166, /proper timber, not just filler/);
    assert.match(PEDIDO_1166, /Just to repeat/);
    assert.doesNotMatch(PEDIDO_1166, /internal/);
  });

  it("o escopo do lance sai do BID_JSON", () => {
    const e = escopoDoLance(lerPayloadDoLance(NOTAS_1166), NOTAS_1166);
    assert.equal(e, "Work: Fill deep indentations using wood filler, sand and repaint\nMaterials: Wood filler, paint");
    assert.equal(escopoDoLance(lerPayloadDoLance("só texto livre"), "só texto livre"), "só texto livre");
  });

  it("caso 1166: o modelo diz que diverge e a pergunta sai limpa, sem travessão", async () => {
    let recebido = "";
    const v = await verificarEscopoDoLance(PEDIDO_1166, escopoDoLance(lerPayloadDoLance(NOTAS_1166), NOTAS_1166), async (_s, u) => {
      recebido = u;
      return RESPOSTA_DIVERGE;
    });
    assert.equal(v.diverge, true);
    assert.equal(v.verificado, true);
    assert.match(v.pergunta, /proper timber/);
    assert.doesNotMatch(v.pergunta, /[—–]/);
    assert.doesNotMatch(v.motivo, /[—–]/);
    assert.match(recebido, /CUSTOMER ASKED FOR:[\s\S]*not just filler/);
    assert.match(recebido, /BID SCOPE:[\s\S]*wood filler/);
  });

  it("bate: diverge false, sem pergunta", async () => {
    const v = await verificarEscopoDoLance("Fix leaking kitchen tap", "Replace tap cartridge", async () =>
      JSON.stringify({ diverge: false, motivo: "", pergunta: "ignored" }),
    );
    assert.deepEqual(v, { diverge: false, motivo: "", pergunta: "", verificado: true });
  });

  it("modelo caiu ou devolveu lixo: não trava o preço, mas avisa que não checou", async () => {
    const caiu = await verificarEscopoDoLance("a", "b", async () => {
      throw new Error("OpenAI 500");
    });
    assert.equal(caiu.diverge, false);
    assert.equal(caiu.verificado, false);
    assert.match(caiu.motivo, /check failed/);
    const lixo = await verificarEscopoDoLance("a", "b", async () => "not json");
    assert.equal(lixo.verificado, false);
  });

  it("sem texto de um dos lados não chama o modelo", async () => {
    let chamou = false;
    const v = await verificarEscopoDoLance("", "Work: x", async () => {
      chamou = true;
      return RESPOSTA_DIVERGE;
    });
    assert.equal(chamou, false);
    assert.equal(v.verificado, false);
  });

  it("parser estrito: diverge precisa ser booleano e, se true, ter pergunta", () => {
    assert.equal(lerVerificacaoDeEscopo('{"diverge":"yes","pergunta":"x"}'), null);
    assert.equal(lerVerificacaoDeEscopo('{"diverge":true,"motivo":"x","pergunta":""}'), null);
    assert.equal(lerVerificacaoDeEscopo("[]"), null);
    assert.equal(lerVerificacaoDeEscopo('{"diverge":true,"motivo":"m","pergunta":"q?"}')?.pergunta, "q?");
  });
});

describe("escopo do lance: resposta do parceiro", () => {
  it("parser da resposta: confirma, valor em texto com £ e resumo sem travessão", () => {
    assert.deepEqual(lerRespostaDoParceiroJson('{"confirma":true,"novo_valor":null,"resumo":"Splice in new timber — then paint."}'), {
      confirma: true,
      resumo: "Splice in new timber, then paint.",
    });
    assert.deepEqual(lerRespostaDoParceiroJson('{"confirma":true,"novo_valor":"£1,250.50","resumo":"x"}'), { confirma: true, novo_valor: 1250.5, resumo: "x" });
    assert.equal(lerRespostaDoParceiroJson('{"confirma":"maybe"}'), null);
  });

  it("decide: confirmou segue, valor novo revisa, recusa ou absurdo vai para gente", () => {
    assert.equal(passoDepoisDaResposta({ confirma: true, resumo: "" }, 200), "seguir");
    assert.equal(passoDepoisDaResposta({ confirma: true, novo_valor: 200, resumo: "" }, 200), "seguir");
    assert.equal(passoDepoisDaResposta({ confirma: true, novo_valor: 340, resumo: "" }, 200), "revisar");
    assert.equal(passoDepoisDaResposta({ confirma: false, novo_valor: 340, resumo: "" }, 200), "pessoa");
    assert.equal(passoDepoisDaResposta({ confirma: true, novo_valor: 2000, resumo: "" }, 200), "pessoa");
    assert.equal(passoDepoisDaResposta(null, 200), "pessoa");
  });

  it("lê a resposta com o modelo; modelo caído vira null (gente decide)", async () => {
    const r = await lerRespostaDoParceiro("q", "Yes, I'll use new timber, £340 all in.", async () =>
      '{"confirma":true,"novo_valor":340,"resumo":"Cut out damaged sections and splice in new timber, fill joints and paint."}',
    );
    assert.equal(passoDepoisDaResposta(r, 200), "revisar");
    assert.equal(await lerRespostaDoParceiro("q", "r", async () => { throw new Error("x"); }), null);
  });

  it("acha a primeira mensagem do parceiro depois da pergunta, ignorando a nossa", () => {
    const perguntadoEm = Date.parse("2026-10-15T10:00:00Z");
    const eventos = [
      { created_at: "2026-10-14T09:00:00Z", message: { body: "Bid sent", from: { email: "whistyle@example.com" } } },
      { created_at: "2026-10-15T10:00:01Z", message: { body: "Quick check on your price", from: { email: "support@getfixfy.zendesk.com" } } },
      { created_at: "2026-10-15T10:05:00Z" },
      { created_at: "2026-10-15T12:30:00Z", message: { body: "Yes timber, same price", from: { email: "WHistyle@example.com" } } },
      { created_at: "2026-10-15T13:00:00Z", message: { body: "and paint", from: { email: "whistyle@example.com" } } },
    ];
    assert.deepEqual(respostaDoParceiro(eventos, perguntadoEm, "whistyle@example.com"), { texto: "Yes timber, same price", em: "2026-10-15T12:30:00Z" });
    assert.equal(respostaDoParceiro(eventos.slice(0, 3), perguntadoEm, "whistyle@example.com"), null);
    assert.equal(respostaDoParceiro(eventos, perguntadoEm, ""), null);
  });
});

describe("escopo do lance: marcas e textos", () => {
  it("a marca de espera vai e volta", () => {
    const e = { bidId: "b-1", sideConversationId: "sc-9", perguntadoEm: 1760522400000 };
    const m = marcaDeEspera(e);
    assert.ok(m.startsWith(`${ESPERANDO_ESCOPO}|`));
    assert.deepEqual(lerMarcaDeEspera(m), e);
    assert.equal(lerMarcaDeEspera("no_bids_reported"), null);
    assert.equal(lerMarcaDeEspera(null), null);
    assert.equal(marcaDeEscopo(m), true);
    assert.equal(marcaDeEscopo(ESCOPO_PRECISA_DE_GENTE), true);
    assert.equal(marcaDeEscopo("no_bids_reported"), false);
    assert.equal(marcaDeEscopo("scope_check_resolved"), false);
  });

  it("valor revisado reescreve o BID_JSON para labour + materials somarem o novo", () => {
    const n = notasComNovoValor(NOTAS_1166, 340, "2026-10-15 12:30");
    const p = lerPayloadDoLance(n);
    assert.equal(p.labourCost + p.materialsCost, 340);
    assert.equal(p.materialsCost, 20);
    assert.match(n, /Thanks/);
    assert.match(n, /Revised to £340\.00/);
    assert.match(notasComNovoValor(null, 300, "x"), /^Revised to £300\.00/);
  });

  it("a mensagem ao parceiro escapa HTML e não tem travessão", () => {
    const h = htmlDaPergunta("QT-2026-1166", "Timber <not> filler?");
    assert.match(h, /QT-2026-1166/);
    assert.match(h, /Timber &lt;not&gt; filler\?/);
    assert.doesNotMatch(h, /[—–]/);
  });
});
