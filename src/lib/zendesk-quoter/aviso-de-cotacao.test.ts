import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decidirAviso,
  TAG_AVISO_COTANDO,
  TAG_AVISO_POSTCODE,
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
