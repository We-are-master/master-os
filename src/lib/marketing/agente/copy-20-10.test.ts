/**
 * Copy de 20/10/2026 nos e-mails de marketing do agente (ids 40, 41 e 42).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { emailDaAvaliacao, ASSUNTO_DA_AVALIACAO } from "./avaliacao";
import { edicaoNova, htmlDaEdicao, ofertaAtiva } from "./clube";
import { pecaDoClube, PECAS_DO_CLUBE } from "./clube-servicos";
import { RELAMPAGOS } from "./calendario";
import { assuntoDoRelampago, emailDoRelampagoPronto } from "./relampago";

const SAIDA = "https://app.getfixfy.com/unsubscribe/abc";
const OUT_20 = new Date("2026-10-20T09:00:00Z");
const DEPOIS_DA_TEMPORADA = new Date("2027-04-02T12:00:00Z");

const limpo = (t: string) => {
  assert.doesNotMatch(t, /[—–]/, "travessão");
  assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, "emoji");
};

test("#40 avaliação: assunto, sem prazo de 14 dias, indicação da configuração com ano", () => {
  const e = emailDaAvaliacao("Sarah", SAIDA, OUT_20);
  assert.equal(e.assunto, "How was your experience with Fixfy?");
  assert.equal(ASSUNTO_DA_AVALIACAO, e.assunto);
  assert.match(e.texto, /Hi Sarah,/);
  assert.doesNotMatch(e.html + e.texto, /14 days|within \d+ days|31 March(?! 2027)/);
  assert.match(e.texto, /They can use REFER20 for £20 off an eligible booking of £100 or more\. The offer is valid until Wed 31 Mar 27\./);
  assert.match(e.html, new RegExp(`href="${SAIDA.replace(/[./]/g, "\\$&")}"[^>]*>Unsubscribe<`));
  assert.ok(!(e.html + e.texto).includes("{{"));
  limpo(e.html + e.texto);
});

test("#40 sem cupom vivo, sem parágrafo de indicação", () => {
  const e = emailDaAvaliacao(undefined, SAIDA, DEPOIS_DA_TEMPORADA);
  assert.doesNotMatch(e.html + e.texto, /REFER20|passing us on|offer/i);
  assert.match(e.texto, /Hi there,/);
  assert.match(e.texto, /Leave a review: https:/);
});

test("#41 clube half day: copy nova, oferta do cupom, variáveis da Resend preservadas", () => {
  const peca = pecaDoClube("half_day_list");
  const e = edicaoNova(peca, { quando: OUT_20 })!;
  assert.equal(e.assunto, "A handyman half day for your home");
  assert.match(e.html, /Hi \{\{\{contact\.first_name\|there\}\}\},/);
  assert.match(e.html, /href="\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}"/);
  assert.match(e.texto, /3\.5 hours to work through suitable jobs, for £180/);
  assert.match(e.texto, /Use HANDY10 for 10% off a handyman half day until Wed 31 Mar 27\./);
  assert.match(e.html, /promo=HANDY10/);
  // Fora as variáveis da Resend ({{{...}}}), nenhum placeholder cru.
  assert.ok(!(e.html + e.texto).replace(/\{\{\{[^}]+\}\}\}/g, "").includes("{{"));
  limpo(e.html + e.texto);
  assert.equal(htmlDaEdicao(peca, OUT_20), e.html);
});

test("#41 oferta vencida some, e o link perde o promo", () => {
  const e = edicaoNova(pecaDoClube("half_day_list"), { quando: DEPOIS_DA_TEMPORADA, primeiroNome: "Sarah", descadastroUrl: SAIDA })!;
  assert.equal(e.oferta, null);
  assert.doesNotMatch(e.html + e.texto, /HANDY10|% off/);
  assert.match(e.texto, /Hi Sarah,/);
  assert.equal(ofertaAtiva("NAOEXISTE", OUT_20), null);
});

test("só a peça aprovada mudou de moldura", () => {
  for (const p of PECAS_DO_CLUBE) assert.equal(Boolean(edicaoNova(p)), p.key === "half_day_list", p.key);
});

test("#42 relâmpago: todos os serviços no assunto e no corpo, prazo com ano, sem 36 horas fixas", () => {
  const r = RELAMPAGOS[0]!;
  const e = emailDoRelampagoPronto(r, { primeiroNome: "Sarah", descadastroUrl: SAIDA });
  assert.equal(assuntoDoRelampago(r), "15% off any Fixfy booking · Ends Thu 22 Oct 26");
  assert.match(e.texto, /Use PAINT15 for 15% off any Fixfy booking made by 11:59pm on Thu 22 Oct 26 \(UK time\)\./);
  assert.match(e.texto, /limited to the first 25 bookings/);
  assert.doesNotMatch(e.html + e.texto, /36 hours|applied for you|Thursday at midnight/i);
  assert.match(e.html, /promo=PAINT15/);
  assert.match(e.html, />Unsubscribe</);
  assert.ok(!(e.html + e.texto).includes("{{"));
  limpo(e.assunto + e.html + e.texto);
});
