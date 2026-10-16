import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  dentroDaJanelaDeEnvio,
  folgaCumprida,
  minutosDoDia,
  partesDeLondres,
  planoDaSequencia,
  vencimentoDoEmail1,
  vencimentoDoProximoEmail,
  vencimentoDoWhatsApp,
} from "./agenda";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 16) : null);
const HORA = 3_600_000;

test("E1: 30 minutos depois, dentro da janela (verão, UTC+1)", () => {
  // parou 15:12 em Londres
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-24T14:12:00Z"))), "2026-09-24T14:42");
});

test("E1: 21:00 em ponto ainda vale; 21:01 vai para as 8h30 do dia seguinte", () => {
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-24T19:30:00Z"))), "2026-09-24T20:00"); // 21:00 BST
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-24T19:31:00Z"))), "2026-09-25T07:30"); // 08:30 BST
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-24T19:30:30Z"))), "2026-09-25T07:30"); // 21:00:30 já é depois
});

test("E1: antes das 8h vai para as 8h30 do MESMO dia; 8h em ponto vale", () => {
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-25T06:00:00Z"))), "2026-09-25T07:30"); // 07:30 BST → 08:30
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-25T06:30:00Z"))), "2026-09-25T07:00"); // 08:00 BST fica
  // parou 23:50 → cairia 00:20 do dia 25: 8h30 do dia 25, não do 26
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-09-24T22:50:00Z"))), "2026-09-25T07:30");
});

test("E1 no inverno (GMT)", () => {
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-12-10T22:40:00Z"))), "2026-12-11T08:30");
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-12-10T15:00:00Z"))), "2026-12-10T15:30");
});

test("E2/E3: 9h30 do dia seguinte ao envio real", () => {
  assert.equal(iso(vencimentoDoProximoEmail(new Date("2026-09-28T10:05:00Z"))), "2026-09-29T08:30"); // 09:30 BST
  // 20:55 BST → 9h30 do dia seguinte fica 12h35 depois: vale
  assert.equal(iso(vencimentoDoProximoEmail(new Date("2026-09-28T19:55:00Z"))), "2026-09-29T08:30");
  assert.equal(iso(vencimentoDoProximoEmail(new Date("2026-12-10T12:00:00Z"))), "2026-12-11T09:30"); // GMT
});

test("E2/E3: nunca menos de 12 horas depois do anterior", () => {
  // saiu 23:00 BST: 9h30 seria 10h30 depois, então vai para 12h depois (11:00 BST)
  const d = vencimentoDoProximoEmail(new Date("2026-09-28T22:00:00Z"));
  assert.equal(iso(d), "2026-09-29T10:00");
});

test("virada do relógio: 25/10/2026 (BST → GMT) e 28/03/2027 (GMT → BST)", () => {
  // sábado 24/10 10:00 BST → domingo 25/10 9h30, já em GMT
  assert.equal(iso(vencimentoDoProximoEmail(new Date("2026-10-24T09:00:00Z"))), "2026-10-25T09:30");
  // sábado 27/03 12:00 GMT → domingo 28/03 9h30, já em BST
  assert.equal(iso(vencimentoDoProximoEmail(new Date("2027-03-27T12:00:00Z"))), "2027-03-28T08:30");
  // E1 que cai de madrugada na noite da troca
  assert.equal(iso(vencimentoDoEmail1(new Date("2026-10-25T00:30:00Z"))), "2026-10-25T08:30"); // 01:00 GMT → 08:30 GMT
  assert.equal(iso(vencimentoDoEmail1(new Date("2027-03-28T00:40:00Z"))), "2027-03-28T07:30"); // 00:40 GMT → 08:30 BST
});

test("WhatsApp: 15h do dia do E3, com pelo menos 5 horas de folga", () => {
  assert.equal(iso(vencimentoDoWhatsApp(new Date("2026-09-30T08:32:00Z"))), "2026-09-30T14:00"); // E3 09:32 BST
  assert.equal(iso(vencimentoDoWhatsApp(new Date("2026-09-30T09:00:00Z"))), "2026-09-30T14:00"); // 10:00 → 5h exatas
  assert.equal(iso(vencimentoDoWhatsApp(new Date("2026-09-30T09:01:00Z"))), "2026-10-01T14:00"); // 10:01 → dia seguinte
  assert.equal(iso(vencimentoDoWhatsApp(new Date("2026-12-11T09:30:00Z"))), "2026-12-11T15:00"); // GMT
});

test("janela de envio: 8h às 21h de Londres", () => {
  assert.equal(dentroDaJanelaDeEnvio(new Date("2026-09-28T06:59:00Z")), false); // 07:59 BST
  assert.equal(dentroDaJanelaDeEnvio(new Date("2026-09-28T07:00:00Z")), true); // 08:00 BST
  assert.equal(dentroDaJanelaDeEnvio(new Date("2026-09-28T20:00:00Z")), true); // 21:00 BST
  assert.equal(dentroDaJanelaDeEnvio(new Date("2026-09-28T20:01:00Z")), false);
  assert.equal(dentroDaJanelaDeEnvio(new Date("2026-12-10T08:00:00Z")), true); // 08:00 GMT
});

test("o caso de 25/09: três e-mails vencidos viram UM toque, e o resto recomeça do envio real", () => {
  const parou = new Date("2026-09-25T18:00:00Z");
  // nada saiu ainda: o E1 está vencido há dias, o resto vem atrás dele
  const antes = planoDaSequencia({ parouEm: parou, enviados: {}, comWhatsApp: true });
  assert.equal(iso(antes[1]), "2026-09-25T18:30");
  // o envio volta segunda 28/09 11:00 BST: sai o E1, e só ele
  const e1 = new Date("2026-09-28T10:00:00Z");
  const depois = planoDaSequencia({ parouEm: parou, enviados: { 1: e1 }, comWhatsApp: true });
  assert.equal(depois[1], null);
  assert.equal(iso(depois[2]), "2026-09-29T08:30");
  assert.equal(iso(depois[3]), "2026-09-30T08:30");
  assert.equal(iso(depois[4]), "2026-09-30T14:00");
  // E2 saiu 09:34 BST de terça: E3 quarta 9h30 e WhatsApp quarta 15h
  const e2 = new Date("2026-09-29T08:34:00Z");
  const p3 = planoDaSequencia({ parouEm: parou, enviados: { 1: e1, 2: e2 }, comWhatsApp: true });
  assert.equal(iso(p3[3]), "2026-09-30T08:30");
  assert.equal(iso(p3[4]), "2026-09-30T14:00");
});

test("sem telefone (ou sem WhatsApp configurado) não existe passo 4", () => {
  const p = planoDaSequencia({ parouEm: new Date("2026-09-28T10:00:00Z"), enviados: {}, comWhatsApp: false });
  assert.equal(p[4], null);
  assert.ok(p[3]);
});

test("quem volta ao site depois do E1 recomeça a contar do último movimento", () => {
  const e1 = new Date("2026-09-28T10:00:00Z");
  const voltou = new Date("2026-09-29T08:00:00Z"); // 09:00 BST de terça
  const p = planoDaSequencia({ parouEm: voltou, enviados: { 1: e1 }, comWhatsApp: false });
  assert.equal(iso(p[2]), "2026-09-30T08:30");
});

test("modo rápido: cada passo vence assim que o anterior sai", () => {
  const parou = new Date("2026-09-28T22:00:00Z");
  const e1 = new Date("2026-09-28T22:10:00Z");
  const p = planoDaSequencia({ parouEm: parou, enviados: { 1: e1 }, comWhatsApp: true, rapido: true });
  assert.equal(iso(p[2]), "2026-09-28T22:10");
  assert.equal(folgaCumprida(2, { 1: e1 }, new Date("2026-09-28T22:20:00Z"), true), true);
  assert.equal(folgaCumprida(2, { 1: e1 }, new Date("2026-09-28T22:20:00Z"), false), false);
});

test("a trava: sem o passo anterior ou antes da folga, não sai", () => {
  const e1 = new Date("2026-09-28T10:00:00Z");
  assert.equal(folgaCumprida(1, {}, e1), true);
  assert.equal(folgaCumprida(2, {}, e1), false);
  assert.equal(folgaCumprida(2, { 1: e1 }, new Date(e1.getTime() + 11 * HORA)), false);
  assert.equal(folgaCumprida(2, { 1: e1 }, new Date(e1.getTime() + 12 * HORA)), true);
  const e3 = new Date("2026-09-30T08:30:00Z");
  assert.equal(folgaCumprida(4, { 3: e3 }, new Date(e3.getTime() + 4 * HORA)), false);
  assert.equal(folgaCumprida(4, { 3: e3 }, new Date(e3.getTime() + 5.5 * HORA)), true);
});

/**
 * Propriedade, numa semana inteira que atravessa a troca de relógio de 25/10:
 * para qualquer hora em que a pessoa pare, e com o motor andando de 10 em 10
 * minutos só dentro da janela, nenhum par de toques fica no mesmo meio
 * período e as folgas valem sempre.
 */
test("uma semana de paradas: folgas, janela e meio período sempre respeitados", () => {
  const volta = (d: Date) => {
    // próxima volta do n8n (múltiplo de 10 min) dentro da janela
    let t = Math.ceil(d.getTime() / 600_000) * 600_000;
    while (!dentroDaJanelaDeEnvio(new Date(t))) t += 600_000;
    return new Date(t);
  };
  const meioPeriodo = (d: Date) => {
    const p = partesDeLondres(d);
    return `${p.ano}-${p.mes}-${p.dia}-${p.hora < 12 ? "am" : "pm"}`;
  };
  for (let t = Date.parse("2026-10-21T00:07:00Z"); t < Date.parse("2026-10-28T00:00:00Z"); t += 37 * 60_000) {
    const parou = new Date(t);
    const enviados: Partial<Record<1 | 2 | 3 | 4, Date>> = {};
    for (const passo of [1, 2, 3, 4] as const) {
      const plano = planoDaSequencia({ parouEm: parou, enviados, comWhatsApp: true });
      const vence = plano[passo]!;
      assert.ok(dentroDaJanelaDeEnvio(vence), `passo ${passo} fora da janela para parada ${parou.toISOString()}`);
      const saiu = volta(vence);
      assert.ok(folgaCumprida(passo, enviados, saiu), `folga do passo ${passo} para parada ${parou.toISOString()}`);
      enviados[passo] = saiu;
    }
    const toques = [enviados[1]!, enviados[2]!, enviados[3]!, enviados[4]!];
    assert.equal(new Set(toques.map(meioPeriodo)).size, 4, `dois toques no mesmo meio período para parada ${parou.toISOString()}`);
    // E2 e E3 às 9h30 (a folga de 12h só age em envio noturno, que a janela não deixa acontecer)
    assert.equal(minutosDoDia(enviados[2]!), 9 * 60 + 30);
    assert.equal(minutosDoDia(enviados[3]!), 9 * 60 + 30);
    assert.equal(minutosDoDia(enviados[4]!), 15 * 60);
  }
});
