/**
 * O que estes testes seguram: o formato do número e o corpo que vai para a
 * Meta. Errar qualquer um dos dois não quebra nada em tempo de compilação —
 * some calado na conta de outra pessoa ou volta 400 num log que ninguém lê.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { WhatsAppError, sendTemplate, toWhatsAppNumber, whatsappConfigured } from "./cloud";

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
