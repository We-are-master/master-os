/**
 * O turno é de Londres, não do relógio da máquina.
 *
 * O caso que este arquivo existe para travar está escrito no plist do Alex, em
 * letra maiúscula: "ATENÇÃO AO FUSO. As horas aqui são de SÃO PAULO, que é o do
 * Mac, não de Londres." Durante o BST são quatro horas de diferença, então um
 * turno de 7h às 22h escrito no agendador roda das 11h às 2h da manhã lá — e
 * quebra de novo no fim de outubro, quando a diferença cai para três.
 *
 * Os horários abaixo são instantes UTC reais, escolhidos nos dois lados da
 * virada britânica, para o teste falhar se alguém trocar o fuso por um
 * deslocamento fixo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinOperatingShift } from "./wall-clock-tz";

test("verão britânico: o turno segue Londres, não São Paulo", () => {
  // 15/08/2026 06:00 UTC = 07:00 em Londres (BST) e 03:00 em São Paulo.
  // Londres já abriu; um portão pelo relógio do Mac ainda estaria fechado.
  assert.equal(isWithinOperatingShift(new Date("2026-08-15T06:00:00Z")), true);

  // 15/08/2026 21:30 UTC = 22:30 em Londres, fora. No Mac seriam 18:30, dentro.
  // É exatamente a ponta que fazia o robô falar de madrugada com o cliente.
  assert.equal(isWithinOperatingShift(new Date("2026-08-15T21:30:00Z")), false);
});

test("inverno britânico: a virada de outubro não exige mexer em nada", () => {
  // 15/12/2026 07:30 UTC = 07:30 em Londres (GMT). Dentro.
  assert.equal(isWithinOperatingShift(new Date("2026-12-15T07:30:00Z")), true);
  // 15/12/2026 06:30 UTC = 06:30 em Londres. Ainda fora, por meia hora.
  assert.equal(isWithinOperatingShift(new Date("2026-12-15T06:30:00Z")), false);
});

test("as bordas são inclusiva no início e exclusiva no fim", () => {
  // 07:00 em Londres entra; 22:00 não. Sem isso, "até as 22h" viraria 22:59.
  assert.equal(isWithinOperatingShift(new Date("2026-08-15T06:00:00Z")), true);
  assert.equal(isWithinOperatingShift(new Date("2026-08-15T21:00:00Z")), false);
});

test("madrugada é sempre fora", () => {
  assert.equal(isWithinOperatingShift(new Date("2026-08-15T02:00:00Z")), false);
  assert.equal(isWithinOperatingShift(new Date("2026-12-15T03:00:00Z")), false);
});

test("a janela é ajustável sem virar outro fuso", () => {
  // 15/08 06:00 UTC = 07:00 Londres: fora de um turno que começa às 9h.
  assert.equal(
    isWithinOperatingShift(new Date("2026-08-15T06:00:00Z"), { startHour: 9 }),
    false,
  );
  assert.equal(
    isWithinOperatingShift(new Date("2026-08-15T21:30:00Z"), { endHour: 23 }),
    true,
  );
});
