import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classificar, linhasDoAlvo, ofertaNoAr, campanhaNaJanela } from "./campanha";

const NOSSA = "conta-nossa";
const c = (id: string, over: Record<string, unknown> = {}) => ({
  id, full_name: "jane doe", email: `${id}@gmail.com`, phone: `0770090${id.padStart(4, "0")}`,
  tags: [], source_account_id: null, last_job_date: null, created_at: "2026-05-01T00:00:00Z", ...over,
});
const vazio = { emails: new Set<string>(), phones: new Set<string>() };

test("separa os três grupos pelo que a pessoa tem", () => {
  const { alvos } = classificar([c("1"), c("2", { email: null }), c("3", { phone: null })], vazio, new Set([NOSSA]));
  assert.deepEqual(alvos.map((a) => a.grupo), ["os_dois", "so_numero", "so_email"]);
  assert.equal(alvos[0].nome, "Jane");
});

test("cliente de plataforma e e-mail de empresa ficam fora", () => {
  const { alvos, fora } = classificar(
    [c("1", { source_account_id: "housekeep" }), c("2", { email: "ana@imobiliaria.co.uk" }), c("3", { source_account_id: NOSSA })],
    vazio,
    new Set([NOSSA]),
  );
  assert.equal(alvos.length, 1);
  assert.equal(fora.plataforma, 1);
  assert.equal(fora.empresa, 1);
});

test("mesmo número ou mesmo e-mail em dois cadastros recebe uma vez", () => {
  const { alvos, fora } = classificar([c("1"), c("2", { phone: "07700900001" }), c("3", { email: "1@gmail.com", phone: null })], vazio, new Set());
  assert.equal(alvos.length, 1);
  assert.equal(fora.duplicado, 2);
});

test("bloqueado num canal continua no outro", () => {
  const { alvos } = classificar([c("1")], { emails: new Set(["1@gmail.com"]), phones: new Set() }, new Set());
  assert.equal(alvos[0].grupo, "so_numero");
});

test("quem teve job nos últimos 7 dias não recebe promoção", () => {
  const { alvos, fora } = classificar([c("1", { last_job_date: new Date().toISOString() })], vazio, new Set());
  assert.equal(alvos.length, 0);
  assert.equal(fora.job_recente, 1);
});

test("os dois: e-mail agora, WhatsApp sem data até o e-mail sair", () => {
  const linhas = linhasDoAlvo({ clientId: "x", nome: "Jane", email: "j@gmail.com", phone: "447700900001", grupo: "os_dois" }, "week10", new Date("2026-09-24T12:00:00Z"));
  assert.deepEqual(linhas.map((l) => [l.passo, l.agendado_para]), [["email_quente", "2026-09-24T12:00:00.000Z"], ["wa_followup", null]]);
});

test("oferta sai do ar antes de sexta 2/10 à meia-noite", () => {
  assert.equal(ofertaNoAr(new Date("2026-10-02T18:00:00Z")), true);
  assert.equal(ofertaNoAr(new Date("2026-10-02T22:00:00Z")), false);
});

test("janela da campanha: 9h às 20h de Londres", () => {
  assert.equal(campanhaNaJanela(new Date("2026-09-24T08:30:00Z")), true); // 09:30 BST
  assert.equal(campanhaNaJanela(new Date("2026-09-24T19:30:00Z")), false); // 20:30 BST
});
