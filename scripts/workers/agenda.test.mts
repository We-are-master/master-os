/**
 *   npx tsx --test scripts/workers/agenda.test.mts
 *
 * A conta do agendador, incluindo as duas viradas de horário do Reino Unido:
 * 25/10/2026 (relógio volta, BST -> GMT, 02:00 BST vira 01:00 GMT) e
 * 28/03/2027 (relógio adianta, 01:00 GMT vira 02:00 BST).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarLondres, londresParaUtc, proximaExecucao } from "./agenda.mts";
import { ROTINAS, lerDesligadas } from "./rotinas.mts";

const iso = (s: string) => new Date(s);
const prox = (agenda: Parameters<typeof proximaExecucao>[0], desde: string) => proximaExecucao(agenda, iso(desde)).toISOString();

test("Londres -> UTC no verão (BST) e no inverno (GMT)", () => {
  assert.equal(londresParaUtc(2026, 10, 14, 17, 0)?.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(londresParaUtc(2026, 12, 1, 17, 0)?.toISOString(), "2026-12-01T17:00:00.000Z");
});

test("hora pulada na virada de março não existe", () => {
  assert.equal(londresParaUtc(2027, 3, 28, 1, 30), null);
  assert.equal(londresParaUtc(2027, 3, 28, 2, 30)?.toISOString(), "2027-03-28T01:30:00.000Z");
});

test("diário: mesma hora de Londres dos dois lados da virada de 25/10/2026", () => {
  const agenda = { tipo: "diario" as const, horarios: ["08:02"] };
  // Sábado 24/10 ainda é BST: 08:02 Londres = 07:02 UTC.
  assert.equal(prox(agenda, "2026-10-24T00:00:00Z"), "2026-10-24T07:02:00.000Z");
  // Domingo 25/10 já é GMT: 08:02 Londres = 08:02 UTC.
  assert.equal(prox(agenda, "2026-10-24T07:02:00Z"), "2026-10-25T08:02:00.000Z");
  assert.equal(formatarLondres(iso("2026-10-25T08:02:00Z")), "2026-10-25 08:02 GMT");
  assert.equal(formatarLondres(iso("2026-10-24T07:02:00Z")), "2026-10-24 08:02 BST");
});

test("diário: virada de março adianta o instante UTC uma hora", () => {
  const agenda = { tipo: "diario" as const, horarios: ["17:00"] };
  assert.equal(prox(agenda, "2027-03-27T12:00:00Z"), "2027-03-27T17:00:00.000Z");
  assert.equal(prox(agenda, "2027-03-27T17:00:00Z"), "2027-03-28T16:00:00.000Z");
});

test("diário: hora repetida de outubro roda uma vez só", () => {
  const agenda = { tipo: "diario" as const, horarios: ["01:30"] };
  const a = proximaExecucao(agenda, iso("2026-10-24T23:00:00Z"));
  const b = proximaExecucao(agenda, a);
  assert.equal(formatarLondres(a).slice(0, 16), "2026-10-25 01:30");
  assert.equal(formatarLondres(b).slice(0, 16), "2026-10-26 01:30");
});

test("diário: vários horários no dia, estritamente depois", () => {
  const agenda = { tipo: "diario" as const, horarios: ["21:00", "18:00", "20:00", "19:00"] };
  // 14/10/2026 18:00 BST = 17:00 UTC; exatamente nesse instante, a próxima é a das 19h.
  assert.equal(prox(agenda, "2026-10-14T17:00:00Z"), "2026-10-14T18:00:00.000Z");
  assert.equal(prox(agenda, "2026-10-14T20:00:00Z"), "2026-10-15T17:00:00.000Z");
});

test("diário com dias da semana: seg-sex pula o fim de semana", () => {
  const agenda = { tipo: "diario" as const, horarios: ["18:00"], diasDaSemana: [1, 2, 3, 4, 5] };
  // Sexta 23/10/2026 depois das 18h -> segunda 26/10, já em GMT.
  assert.equal(prox(agenda, "2026-10-23T18:00:00Z"), "2026-10-26T18:00:00.000Z");
});

test("diário com dias da semana: sábado só", () => {
  const agenda = { tipo: "diario" as const, horarios: ["18:00"], diasDaSemana: [6] };
  assert.equal(prox(agenda, "2026-10-14T12:00:00Z"), "2026-10-17T17:00:00.000Z");
  assert.equal(prox(agenda, "2026-10-17T17:00:00Z"), "2026-10-24T17:00:00.000Z");
  assert.equal(prox(agenda, "2026-10-24T17:00:00Z"), "2026-10-31T18:00:00.000Z");
});

test("dia da semana é o de Londres, não o do UTC", () => {
  // 00:30 de sábado em Londres (BST) ainda é sexta 23:30 em UTC.
  const agenda = { tipo: "diario" as const, horarios: ["00:30"], diasDaSemana: [6] };
  assert.equal(prox(agenda, "2026-10-12T00:00:00Z"), "2026-10-16T23:30:00.000Z");
});

test("intervalo: alinhado ao relógio e estritamente depois", () => {
  const dez = { tipo: "intervalo" as const, minutos: 10 };
  assert.equal(prox(dez, "2026-10-14T16:03:30Z"), "2026-10-14T16:10:00.000Z");
  assert.equal(prox(dez, "2026-10-14T16:10:00Z"), "2026-10-14T16:20:00.000Z");
  const dois = { tipo: "intervalo" as const, minutos: 2 };
  assert.equal(prox(dois, "2026-10-14T16:03:30Z"), "2026-10-14T16:04:00.000Z");
});

test("intervalo atravessa a virada sem buraco nem repetição", () => {
  const dez = { tipo: "intervalo" as const, minutos: 10 };
  // 00:55 UTC de 25/10 = 01:55 BST; depois vem 01:00 GMT (01:00 UTC).
  assert.equal(prox(dez, "2026-10-25T00:55:00Z"), "2026-10-25T01:00:00.000Z");
});

test("horário inválido é erro", () => {
  assert.throws(() => proximaExecucao({ tipo: "diario", horarios: ["25:00"] }, new Date()));
  assert.throws(() => proximaExecucao({ tipo: "diario", horarios: ["8h"] }, new Date()));
  assert.throws(() => proximaExecucao({ tipo: "intervalo", minutos: 0 }, new Date()));
});

test("toda rotina cadastrada tem próxima execução", () => {
  for (const r of ROTINAS) assert.ok(proximaExecucao(r.agenda, iso("2026-10-24T12:00:00Z")) instanceof Date, r.nome);
  assert.equal(new Set(ROTINAS.map((r) => r.nome)).size, ROTINAS.length);
});

test("WORKERS_DESLIGAR: nome curto, label do launchd e asterisco", () => {
  assert.deepEqual([...lerDesligadas("stefane, daily-report")].sort(), ["daily-report", "stefane"]);
  assert.deepEqual([...lerDesligadas("com.fixfy.stefane-worker")], ["stefane"]);
  assert.deepEqual([...lerDesligadas("stefane-worker")], ["stefane"]);
  assert.equal(lerDesligadas("*").size, ROTINAS.length);
  assert.equal(lerDesligadas("").size, 0);
  assert.equal(lerDesligadas(undefined).size, 0);
});

test("WORKERS_DESLIGAR: nome desconhecido derruba (erro de digitação = envio em dobro)", () => {
  assert.throws(() => lerDesligadas("stefanee"), /desconhecido/);
});
