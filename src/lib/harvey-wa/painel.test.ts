import { test } from "node:test";
import assert from "node:assert/strict";
import { conversasParadas, diasDaJanela, resumoDoHarveyHtml, somaDoFunil, tempo, vendasPorDia, type PainelDoHarvey } from "./painel";

const agora = new Date("2026-10-23T12:00:00Z");

test("janela: do mais antigo a hoje", () => {
  assert.deepEqual(diasDaJanela(agora, 3), ["2026-10-21", "2026-10-22", "2026-10-23"]);
});

test("cada coisa conta no dia em que aconteceu", () => {
  const dias = diasDaJanela(agora, 3);
  const r = vendasPorDia(
    [
      { criado_em: "2026-10-21T09:00:00Z", estado: "harvey", passou_em: null, checkout_ref: "FX-1", checkout_at: "2026-10-22T10:00:00Z", checkout_total: 72 },
      { criado_em: "2026-10-22T09:00:00Z", estado: "equipe", passou_em: "2026-10-23T08:00:00Z", checkout_ref: null, checkout_at: null, checkout_total: null },
      { criado_em: "2026-10-01T09:00:00Z", estado: "harvey", passou_em: null, checkout_ref: "FX-2", checkout_at: "2026-10-23T09:00:00Z", checkout_total: "90" },
    ],
    [{ created_at: "2026-10-22T11:00:00Z", status: "bidding" }],
    dias,
  );
  assert.deepEqual(r[0], { dia: "2026-10-21", conversas: 1, passadas: 0, cotacoes: 0, links: 1, pagos: 0, valor: 0 });
  assert.deepEqual(r[1], { dia: "2026-10-22", conversas: 1, passadas: 0, cotacoes: 1, links: 0, pagos: 1, valor: 72 });
  assert.deepEqual(r[2], { dia: "2026-10-23", conversas: 0, passadas: 1, cotacoes: 0, links: 0, pagos: 1, valor: 90 });
  const s = somaDoFunil(r);
  assert.equal(s.pagos, 2);
  assert.equal(s.valor, 162);
  assert.equal(s.conversao, 100);
});

test("sem conversa, conversão vazia (não 0%)", () => {
  assert.equal(somaDoFunil(vendasPorDia([], [], diasDaJanela(agora, 2))).conversao, null);
});

test("parada: cliente esperando há mais de 20 min; respondido ou recente não entra", () => {
  const rs = (v: string) => [{ id: 5698641403423, value: v }];
  const p = conversasParadas(
    [
      { id: 1, subject: "Conversation with Harriet", updated_at: "2026-10-21T10:55:00Z", tags: ["harvey_wa"], custom_fields: rs("reply_awaiting") },
      { id: 2, subject: "Frede", updated_at: "2026-10-23T11:50:00Z", tags: ["harvey_wa"], custom_fields: rs("reply_awaiting") },
      { id: 3, subject: "Ok", updated_at: "2026-10-23T09:00:00Z", tags: ["harvey_wa"], custom_fields: rs("reply_replied") },
      { id: 4, subject: "Team", updated_at: "2026-10-23T11:00:00Z", tags: ["harvey_wa", "harvey_passou"], custom_fields: rs("reply_awaiting") },
    ],
    agora,
  );
  assert.deepEqual(p.map((c) => c.ticketId), [1, 4]);
  assert.equal(p[0]!.comHarvey, true);
  assert.equal(p[1]!.comHarvey, false);
  assert.equal(tempo(p[0]!.minutos), "2d");
});

test("brief: ontem em uma linha e quem está esperando", () => {
  const dias = vendasPorDia([], [], diasDaJanela(agora, 7));
  dias[5] = { ...dias[5]!, conversas: 4, pagos: 1, valor: 72 };
  const p: PainelDoHarvey = { dias, semana: somaDoFunil(dias), hoje: dias[6]!, paradas: [{ ticketId: 51567, assunto: "Conversation with Harriet", minutos: 3000, comHarvey: true }], pendentes: [], falhas: [], geradoEm: agora.toISOString() };
  const html = resumoDoHarveyHtml(p);
  assert.match(html, /4 new chats/);
  assert.match(html, /1 paid \(£72\.00\)/);
  assert.match(html, /#51567 · Conversation with Harriet · 2d/);
});
