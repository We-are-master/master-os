import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PECAS_DO_CLUBE } from "./clube-servicos";
import { acharCupom } from "@/lib/marketing/cupons";
import { CLUBE, RELAMPAGOS, abreEm, fechaEm, horaDeLondres, quandoSaiAEdicao, relampagoDoDia, relampagoNoAr } from "./calendario";
import { htmlDaEdicao, pecaDaEdicao } from "./clube";
import { tetoDaLista } from "./lista";
import { TEMPLATE_DO_WHATSAPP, htmlDoRelampago } from "./relampago";

test("10h de Londres vira a hora certa em UTC antes e depois do fim do horário de verão", () => {
  assert.equal(horaDeLondres("2026-10-20", 10).toISOString(), "2026-10-20T09:00:00.000Z");
  assert.equal(horaDeLondres("2026-10-27", 10).toISOString(), "2026-10-27T10:00:00.000Z");
});

test("o clube tem 26 edições em três meses, em ordem, sem peça repetida e todas na agenda", () => {
  assert.equal(CLUBE.length, 26);
  assert.equal(new Set(CLUBE.map((e) => e.key)).size, 26);
  const datas = CLUBE.map((e) => quandoSaiAEdicao(e).getTime());
  assert.deepEqual(datas, [...datas].sort((a, b) => a - b));
  for (const e of CLUBE) assert.ok(PECAS_DO_CLUBE.some((p) => p.key === e.key), e.key);
  assert.equal(PECAS_DO_CLUBE.length, 26);
  assert.ok(!CLUBE.some((e) => e.dia === "2026-12-25" || e.dia === "2027-01-01"));
});

test("cupom de edição existe na lista e ainda vale no dia em que o e-mail sai", () => {
  for (const e of CLUBE) {
    const peca = pecaDaEdicao(e);
    if (!peca.cupom) continue;
    const cupom = acharCupom(peca.cupom);
    assert.ok(cupom, peca.cupom);
    assert.ok(Date.parse(`${cupom.expiraEm}T23:59:59Z`) > quandoSaiAEdicao(e).getTime() + 3 * 24 * 60 * 60 * 1000, `${peca.cupom} vence perto demais de ${e.dia}`);
  }
});

test("o e-mail leva as variáveis da Resend e nenhum depoimento", () => {
  const html = htmlDaEdicao(pecaDaEdicao(CLUBE[0]));
  assert.ok(html.includes("Hi {{{contact.first_name|there}}},"));
  assert.ok(html.includes('href="{{{RESEND_UNSUBSCRIBE_URL}}}"'));
  for (const e of CLUBE) assert.ok(!htmlDaEdicao(pecaDaEdicao(e)).includes("Verified Fixfy customer"), e.key);
});

test("relâmpago abre quarta 11h, fecha quinta 23:59 e não cai em dia de clube", () => {
  for (const r of RELAMPAGOS) {
    assert.equal(new Date(`${r.dia}T12:00:00Z`).getUTCDay(), 3, r.slug);
    const horas = (fechaEm(r).getTime() - abreEm(r).getTime()) / 3_600_000;
    assert.ok(horas > 36.9 && horas < 37, `${r.slug}: ${horas}h`);
    assert.ok(!CLUBE.some((e) => e.dia === r.dia));
    assert.ok(htmlDoRelampago(r).includes(`promo=${r.codigo}`));
    assert.ok(!acharCupom(r.codigo), `${r.codigo} colide com cupom da temporada`);
  }
  assert.equal(new Set(RELAMPAGOS.map((r) => r.codigo)).size, RELAMPAGOS.length);
});

test("relâmpago do dia e relâmpago no ar", () => {
  assert.equal(relampagoDoDia(new Date("2026-10-21T06:00:00Z"))?.slug, "paint15");
  assert.equal(relampagoDoDia(new Date("2026-10-22T06:00:00Z")), null);
  assert.equal(relampagoNoAr(new Date("2026-10-21T15:00:00Z"))?.slug, "paint15");
  assert.equal(relampagoNoAr(new Date("2026-10-21T08:00:00Z")), null);
  // Faltando menos de 3 horas não sai mais WhatsApp.
  assert.equal(relampagoNoAr(new Date("2026-10-22T21:30:00Z")), null);
});

test("a lista cresce 1.000 por dia até 5 mil", () => {
  assert.equal(tetoDaLista(new Date("2026-10-14T20:00:00Z")), 1000);
  assert.equal(tetoDaLista(new Date("2026-10-15T12:00:00Z")), 2000);
  assert.equal(tetoDaLista(new Date("2026-10-17T12:00:00Z")), 4000);
  assert.equal(tetoDaLista(new Date("2026-11-10T12:00:00Z")), 5000);
});

test("o template do WhatsApp tem as quatro variáveis que o envio preenche", () => {
  assert.deepEqual(TEMPLATE_DO_WHATSAPP.corpo.match(/\{\{\d\}\}/g), ["{{1}}", "{{2}}", "{{3}}", "{{4}}"]);
});

import { SEQUENCIA_B2B, escolherOnda, htmlDoB2B, quandoSai } from "./b2b";

test("agências: 16 e-mails em ordem, 8 de oferta e 8 de nutrição, todos com PDF, reunião e saída", () => {
  assert.equal(SEQUENCIA_B2B.length, 16);
  assert.equal(SEQUENCIA_B2B.filter((e) => e.fase === "oferta").length, 8);
  const datas = SEQUENCIA_B2B.map((e) => quandoSai(e, "2026-10-15").getTime());
  assert.deepEqual(datas, [...datas].sort((a, b) => a - b));
  assert.equal(quandoSai(SEQUENCIA_B2B[0], "2026-10-15").toISOString(), "2026-10-15T07:30:00.000Z");
  assert.equal(quandoSai(SEQUENCIA_B2B[8], "2026-10-15").toISOString(), "2026-11-16T08:30:00.000Z");
  for (const e of SEQUENCIA_B2B) {
    const html = htmlDoB2B(e);
    assert.ok(html.includes("/r/fixfy-for-business") && html.includes("/r/fixfy-price-list"), e.key);
    assert.ok(html.includes("mailto:victor@getfixfy.com?subject="), e.key);
    assert.ok(html.includes("{{{RESEND_UNSUBSCRIBE_URL}}}") && html.includes("Victor Braz"), e.key);
    assert.ok(!html.includes("—"), `${e.key} tem travessão`);
    assert.ok(e.assunto.length <= 70, `${e.key}: assunto longo`);
  }
});

test("agências: a onda seguinte anda os mesmos dias", () => {
  assert.equal(quandoSai(SEQUENCIA_B2B[1], "2026-11-12").toISOString().slice(0, 10), "2026-11-16");
});

test("agências: a onda põe pessoa antes de caixa geral e pula bloqueado e quem já está em onda", () => {
  const c = (email: string, first_name: string | null, unsubscribed = false) => ({ email, first_name, unsubscribed });
  const lista = [c("info@a.co.uk", "A Lettings Team"), c("jane@b.co.uk", "Jane"), c("sam@c.co.uk", "Sam"), c("x@d.co.uk", "X", true), c("tom@e.co.uk", "Tom")];
  const onda = escolherOnda(lista, new Set(["sam@c.co.uk"]), new Set(["tom@e.co.uk"]), 2);
  assert.deepEqual(onda.map((o) => o.email), ["jane@b.co.uk", "info@a.co.uk"]);
});

test("clube B2C: nenhuma peça fala de mudança de casa, e não repete o mesmo serviço em edições seguidas", () => {
  const proibido = /end of tenancy|move-out|moving|deposit|check-out|gutter/i;
  for (const e of CLUBE) {
    const html = htmlDaEdicao(pecaDaEdicao(e));
    assert.ok(!proibido.test(html.replace(/https?:[^"]+/g, "")), e.key);
    assert.ok(!html.includes("—"), `${e.key} tem travessão`);
  }
  const tipos = CLUBE.map((e) => pecaDaEdicao(e).etiqueta);
  for (let i = 1; i < tipos.length; i++) assert.notEqual(tipos[i], tipos[i - 1], `${CLUBE[i].dia} repete ${tipos[i]}`);
});

import { posicaoDoCliente, segmentoDaPosicao } from "./lista";
import { vaiParaSemanal } from "./clube";

test("posição do lead: novo, demorando, antigo, em andamento, cliente recente e cliente", () => {
  const hoje = new Date("2026-10-14T12:00:00Z");
  const criado = (dias: number) => ({ created_at: new Date(hoje.getTime() - dias * 864e5).toISOString() });
  const job = (status: string, dias: number) => ({ status, scheduled_date: new Date(hoje.getTime() - dias * 864e5).toISOString().slice(0, 10), created_at: hoje.toISOString() });
  assert.equal(posicaoDoCliente(criado(3), [], hoje).posicao, "A");
  assert.equal(posicaoDoCliente(criado(40), [], hoje).posicao, "B");
  assert.equal(posicaoDoCliente(criado(200), [], hoje).posicao, "C");
  assert.equal(posicaoDoCliente(criado(200), [job("scheduled", -2)], hoje).posicao, "D");
  assert.equal(posicaoDoCliente(criado(200), [job("completed", 12)], hoje).posicao, "E");
  assert.equal(posicaoDoCliente(criado(200), [job("completed", 90)], hoje).posicao, "F");
  // Job cancelado não conta: continua lead.
  assert.equal(posicaoDoCliente(criado(40), [job("cancelled", 5)], hoje).posicao, "B");
  assert.deepEqual(["A", "B", "C", "D", "E", "F"].map((p) => segmentoDaPosicao(p as never)), [null, "duas", "semanal", null, null, "duas"]);
});

test("a lista semanal recebe só as edições de terça", () => {
  const semanais = CLUBE.filter(vaiParaSemanal);
  assert.ok(semanais.length >= 12 && semanais.every((e) => new Date(`${e.dia}T12:00:00Z`).getUTCDay() === 2));
});

import { ONDAS } from "./b2b";
test("agências: nenhuma onda manda e-mail no fim de semana", () => {
  for (const o of ONDAS) for (const e of SEQUENCIA_B2B) {
    const dia = quandoSai(e, o.inicio).getUTCDay();
    assert.ok(dia !== 0 && dia !== 6, `onda ${o.n} · ${e.key} cai no fim de semana`);
  }
});
