import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decidirAviso,
  TAG_AVISO_COTANDO,
  TAG_AVISO_POSTCODE,
  respondeuComPostcode,
  TAG_POSTCODE_RECEBIDO,
} from "./aviso-de-cotacao";

/** O caso feliz: endereço na mão e parceiros convidados. */
const COMPLETO = { armado: true, orgReconhecida: true, temEndereco: true, convitesEnviados: 5, tags: [] as string[] };

test("desligado nao fala, mesmo com tudo pronto", () => {
  const d = decidirAviso({ ...COMPLETO, armado: false });
  assert.equal(d.fala, false);
});

test("organizacao nao reconhecida nunca fala em publico", () => {
  // O requester aqui pode ser o morador, e "Hi Team" chega errado na casa dele.
  const d = decidirAviso({ ...COMPLETO, orgReconhecida: false });
  assert.equal(d.fala, false);
});

test("com endereco e convites: diz que esta cotando e vai para Bidding", () => {
  const d = decidirAviso(COMPLETO);
  assert.equal(d.fala, true);
  if (!d.fala) return;
  assert.equal(d.cara, "cotando");
  assert.equal(d.tag, TAG_AVISO_COTANDO);
  assert.match(d.html, /working on a quote/);
  assert.doesNotMatch(d.html, /postcode/);
});

test("com endereco mas ZERO convites: cala a boca", () => {
  // Promessa sem lastro: ninguem foi perguntado. Aconteceu de verdade na
  // QT-2026-1144, que tem postcode e nenhum parceiro cobre CR4.
  const d = decidirAviso({ ...COMPLETO, convitesEnviados: 0 });
  assert.equal(d.fala, false);
});

test("sem endereco: pede o postcode e nao promete preco", () => {
  const d = decidirAviso({ ...COMPLETO, temEndereco: false, convitesEnviados: 0 });
  assert.equal(d.fala, true);
  if (!d.fala) return;
  assert.equal(d.cara, "pede_postcode");
  assert.equal(d.tag, TAG_AVISO_POSTCODE);
  assert.match(d.html, /confirm the property postcode/);
  assert.doesNotMatch(d.html, /working on a quote/);
});

test("a tag e a trava: nao repete a mesma cara no mesmo ticket", () => {
  assert.equal(decidirAviso({ ...COMPLETO, tags: [TAG_AVISO_COTANDO] }).fala, false);
  assert.equal(
    decidirAviso({ ...COMPLETO, temEndereco: false, convitesEnviados: 0, tags: [TAG_AVISO_POSTCODE] }).fala,
    false,
  );
});

test("pedimos o postcode, o cliente respondeu: agora pode dizer que esta cotando", () => {
  // A tag de postcode continua no ticket; ela nao pode calar a outra cara.
  const d = decidirAviso({ ...COMPLETO, tags: [TAG_AVISO_POSTCODE] });
  assert.equal(d.fala, true);
  if (!d.fala) return;
  assert.equal(d.cara, "cotando");
});

test("nenhuma das duas mensagens leva assinatura", () => {
  // A assinatura do Zendesk entra sozinha no envio; duas e a marca do robo.
  for (const d of [
    decidirAviso(COMPLETO),
    decidirAviso({ ...COMPLETO, temEndereco: false, convitesEnviados: 0 }),
  ]) {
    if (!d.fala) throw new Error("deveria falar");
    assert.doesNotMatch(d.html, /Fixfy|Leo|Victor|Kind regards|Best regards/);
  }
});

/* ── destravar o ticket parado ─────────────────────────────────────────── */
const LEO = 6227542863391;
const ask = { authorId: LEO, publico: true, corpo: "could you confirm the property postcode?", papel: "agent" };

test("cliente respondeu com postcode: destrava", () => {
  assert.equal(respondeuComPostcode([
    { authorId: 9, publico: true, corpo: "need a quote for my bathroom", papel: "end-user" },
    ask,
    { authorId: 9, publico: true, corpo: "sure, it's NW2 0TT", papel: "end-user" },
  ], LEO), true);
});

test("cliente respondeu SEM postcode: continua parado", () => {
  // Destravar aqui faria o ciclo perguntar de novo, e o cliente levaria a
  // mesma pergunta em looping.
  assert.equal(respondeuComPostcode([
    ask,
    { authorId: 9, publico: true, corpo: "sorry, I'll check with the tenant", papel: "end-user" },
  ], LEO), false);
});

test("postcode que veio ANTES da pergunta não conta", () => {
  assert.equal(respondeuComPostcode([
    { authorId: 9, publico: true, corpo: "bathroom at NW2 0TT", papel: "end-user" },
    ask,
  ], LEO), false);
});

test("nota interna do agente com postcode não destrava", () => {
  assert.equal(respondeuComPostcode([
    ask,
    { authorId: 5679223041823, publico: true, corpo: "chased them, address is NW2 0TT", papel: "agent" },
  ], LEO), false);
});

test("sem pergunta nenhuma no ticket, não há o que destravar", () => {
  assert.equal(respondeuComPostcode([
    { authorId: 9, publico: true, corpo: "NW2 0TT", papel: "end-user" },
  ], LEO), false);
});

/* ── a terceira cara: ele respondeu o que faltava ──────────────────────── */
test("quem respondeu o postcode ouve outra coisa, nao o agradecimento do envio", () => {
  const d = decidirAviso({ ...COMPLETO, tags: [TAG_POSTCODE_RECEBIDO] });
  assert.equal(d.fala, true);
  if (!d.fala) return;
  assert.equal(d.cara, "cotando");
  assert.equal(d.tag, TAG_AVISO_COTANDO);
  assert.match(d.html, /Thank you\. We're working on a quote now/);
  assert.match(d.html, /let you know if we need anything else/);
  // agradecer o envio a quem ja enviou e ja respondeu soa a robo que nao leu.
  assert.doesNotMatch(d.html, /Thanks for sending this over/);
  assert.doesNotMatch(d.html, /Fixfy|Leo|Victor|regards/);
});

test("sem a marca de resposta, o texto continua sendo o primeiro", () => {
  const d = decidirAviso(COMPLETO);
  if (!d.fala) throw new Error("deveria falar");
  assert.match(d.html, /Thanks for sending this over/);
});

test("a marca de resposta nao fura a trava de ja ter falado", () => {
  assert.equal(
    decidirAviso({ ...COMPLETO, tags: [TAG_POSTCODE_RECEBIDO, TAG_AVISO_COTANDO] }).fala,
    false,
  );
});
