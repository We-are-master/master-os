/**
 * O que estes testes seguram: o formato do número e o corpo que vai para a
 * Meta. Errar qualquer um dos dois não quebra nada em tempo de compilação —
 * some calado na conta de outra pessoa ou volta 400 num log que ninguém lê.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { WhatsAppError, buscarTemplate, sendTemplate, toWhatsAppNumber, whatsappConfigured } from "./cloud";

const fetchOriginal = globalThis.fetch;

/** Troca o fetch por um que grava a chamada e devolve o que o teste mandar. */
function fetchFalso(resposta: { ok?: boolean; body?: unknown } = {}) {
  const chamadas: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    chamadas.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")), auth: headers.Authorization });
    return {
      ok: resposta.ok ?? true,
      status: resposta.ok === false ? 400 : 200,
      json: async () => resposta.body ?? { messages: [{ id: "wamid.TESTE" }] },
    };
  }) as unknown as typeof fetch;
  return chamadas;
}

describe("número do WhatsApp", () => {
  it("aceita o que o banco tem hoje e devolve só dígitos com país", () => {
    assert.equal(toWhatsAppNumber("+44 7123 456789"), "447123456789");
    assert.equal(toWhatsAppNumber("07123 456789"), "447123456789");
    assert.equal(toWhatsAppNumber("447123456789"), "447123456789");
  });

  it("recusa o que não dá para confiar em vez de inventar um país", () => {
    assert.equal(toWhatsAppNumber("123456"), null);
    assert.equal(toWhatsAppNumber(""), null);
    assert.equal(toWhatsAppNumber(null), null);
  });
});

describe("envio de template", () => {
  beforeEach(() => {
    process.env.WHATSAPP_TOKEN = "token-de-teste";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111222333";
    process.env.WHATSAPP_API_VERSION = "v21.0";
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_VERSION;
  });

  it("manda o corpo que a Meta espera, pelo número que envia", async () => {
    const chamadas = fetchFalso();
    const r = await sendTemplate({ to: "07123456789", name: "confirmation", language: "en", bodyParams: ["Ana", "Friday"] });

    assert.equal(r.messageId, "wamid.TESTE");
    assert.equal(r.to, "447123456789");
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, "https://graph.facebook.com/v21.0/111222333/messages");
    assert.equal(chamadas[0].auth, "Bearer token-de-teste");
    assert.deepEqual(chamadas[0].body, {
      messaging_product: "whatsapp",
      to: "447123456789",
      type: "template",
      template: {
        name: "confirmation",
        language: { code: "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "Friday" }] },
        ],
      },
    });
  });

  it("botão de link com parte variável vai como component `button` na posição dele", async () => {
    const chamadas = fetchFalso();
    await sendTemplate({
      to: "07123456789",
      name: "fixfy_booking_recovery_v1",
      language: "en_GB",
      bodyParams: ["Ana", "2 bed deep clean", "COMEBACK10"],
      urlButtons: [{ index: 0, suffix: "?s=clean&size=2&promo=COMEBACK10" }],
    });
    const t = chamadas[0].body.template as { components: unknown[] };
    assert.deepEqual(t.components, [
      { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "2 bed deep clean" }, { type: "text", text: "COMEBACK10" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "?s=clean&size=2&promo=COMEBACK10" }] },
    ]);
  });

  it("lê um template pelo nome: status e a ordem dos botões", async () => {
    process.env.WHATSAPP_WABA_ID = "999";
    const chamadas = fetchFalso({
      body: {
        data: [
          {
            name: "fixfy_booking_recovery_v1",
            language: "en_GB",
            status: "PENDING",
            category: "MARKETING",
            components: [
              { type: "BODY", text: "Hi {{1}}, your {{2}} price is still saved, code {{3}}." },
              { type: "BUTTONS", buttons: [{ type: "URL", text: "Finish my booking", url: "https://www.getfixfy.com/{{1}}" }, { type: "QUICK_REPLY", text: "Stop promotions" }] },
            ],
          },
        ],
      },
    });
    const t = await buscarTemplate("fixfy_booking_recovery_v1", "en_GB");
    delete process.env.WHATSAPP_WABA_ID;
    assert.match(chamadas[0].url, /\/999\/message_templates\?name=fixfy_booking_recovery_v1&fields=/);
    assert.equal(t?.status, "PENDING");
    assert.equal(t?.bodyVariables, 3);
    assert.deepEqual(t?.buttons.map((b) => b.type), ["URL", "QUICK_REPLY"]);
  });

  it("template que não existe naquele idioma volta null", async () => {
    process.env.WHATSAPP_WABA_ID = "999";
    fetchFalso({ body: { data: [{ name: "x", language: "en_US", status: "APPROVED", category: "MARKETING" }] } });
    const t = await buscarTemplate("x", "en_GB");
    delete process.env.WHATSAPP_WABA_ID;
    assert.equal(t, null);
  });

  it("template sem variável vai sem components: mandar vazio faz a Meta recusar", async () => {
    const chamadas = fetchFalso();
    await sendTemplate({ to: "+447123456789", name: "hello" });
    assert.equal("components" in (chamadas[0].body.template as Record<string, unknown>), false);
  });

  it("número impossível nem sai do processo", async () => {
    const chamadas = fetchFalso();
    await assert.rejects(() => sendTemplate({ to: "123", name: "confirmation" }), WhatsAppError);
    assert.equal(chamadas.length, 0);
  });

  it("erro da Meta chega com a mensagem dela, não com um 'falhou'", async () => {
    fetchFalso({ ok: false, body: { error: { message: "Template name does not exist", code: 132001 } } });
    await assert.rejects(
      () => sendTemplate({ to: "07123456789", name: "nao-existe" }),
      (e: unknown) => e instanceof WhatsAppError && e.code === 132001 && /does not exist/.test(e.message),
    );
  });

  it("sem token ou sem número que envia, o chamador sabe antes de tentar", () => {
    assert.equal(whatsappConfigured(), true);
    delete process.env.WHATSAPP_TOKEN;
    assert.equal(whatsappConfigured(), false);
  });
});
