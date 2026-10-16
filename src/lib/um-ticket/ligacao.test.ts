import { test } from "node:test";
import assert from "node:assert/strict";
import { ligacoesParaAnotar, tagDaLigacao, textoDaNotaDeLigacao, type TicketAberto, type TicketDeLigacao } from "./ligacao";

const lig = (x: Partial<TicketDeLigacao> & { id: number }): TicketDeLigacao => ({ requesterId: 7, criadoEm: "2026-10-14T09:00:00Z", assunto: "Call with Ana", canal: "voice", tags: [], ...x });
const ab = (x: Partial<TicketAberto> & { id: number }): TicketAberto => ({ requesterId: 7, status: "open", canal: "email", atualizadoEm: "2026-10-13T09:00:00Z", tags: [], ...x });

test("a ligação vai para o ticket aberto mais recente do mesmo cliente", () => {
  const r = ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1 }), ab({ id: 2, atualizadoEm: "2026-10-14T08:00:00Z", canal: "whatsapp" })]);
  assert.deepEqual(r.map((x) => [x.ligacao.id, x.alvo]), [[100, 2]]);
});

test("sem ticket aberto, outro ticket de voz, parceiro ou já anotada: nada", () => {
  assert.equal(ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1, status: "solved" })]).length, 0);
  assert.equal(ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1, canal: "voice" })]).length, 0);
  assert.equal(ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1, tags: ["partner"] })]).length, 0);
  assert.equal(ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1, tags: [tagDaLigacao(100)] })]).length, 0);
  assert.equal(ligacoesParaAnotar([lig({ id: 100 })], [ab({ id: 1, requesterId: 8 })]).length, 0);
});

test("ticket que não é de voz não entra como ligação", () => {
  assert.equal(ligacoesParaAnotar([lig({ id: 100, canal: "email" })], [ab({ id: 1 })]).length, 0);
});

test("texto da nota: perdida sem gravação, sem travessão", () => {
  const t = textoDaNotaDeLigacao(lig({ id: 100, assunto: "Abandoned Call from: Caller +44" }), "fixfy");
  assert.match(t, /^📞 Missed call with this customer on .* ticket #100\. https:\/\/fixfy\.zendesk\.com\/agent\/tickets\/100$/);
  assert.match(textoDaNotaDeLigacao(lig({ id: 101 }), "fixfy"), /recording there/);
  assert.ok(!t.includes("—"));
});
