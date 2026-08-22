import { strict as assert } from "node:assert";
import { test } from "node:test";
import { soOqueENovo } from "./sem-citacao";

test("a mensagem nova fica, o bloco citado sai", () => {
  // A forma exata que criou o JOB-9493: a nossa mensagem de ontem citada de
  // volta embaixo da mensagem nova, e mais rica que ela.
  const corpo = [
    "Job is taken but we have this job available tomorrow",
    "Type of clean: Deep clean",
    "Address: SW8 1EN",
    "",
    "> **You**:",
    "> Freddie",
    "> 51b Clanricarde Gardens, London, W2 4JN",
    "> Scope: fill the hole, 2 coats of paint",
  ].join("\n");
  const r = soOqueENovo(corpo);
  assert.ok(r.includes("Deep clean"));
  assert.ok(r.includes("SW8 1EN"));
  assert.ok(!r.includes("Freddie"));
  assert.ok(!r.includes("Clanricarde"));
});

test("corta na linha que o Zendesk usa para separar", () => {
  const r = soOqueENovo("New booking for Friday\n##- Please type your reply above this line -##\nOld job at W2 4JN for Freddie");
  assert.equal(r, "New booking for Friday");
});

test("os outros separadores de cliente de e-mail", () => {
  for (const sep of ["----- Original Message -----", "_______________", "On 21 Aug 2026 at 09:41, Sean wrote:", "From: sean@housekeep.com"]) {
    const r = soOqueENovo(`Booked for Monday\n${sep}\nFreddie at W2 4JN`);
    assert.equal(r, "Booked for Monday", `nao cortou em "${sep}"`);
  }
});

test("comentario que e so historico devolve vazio", () => {
  // Fingir que tem informacao nova e exatamente como o JOB-9493 aconteceu.
  assert.equal(soOqueENovo("> Freddie\n> 51b Clanricarde Gardens\n> £325"), "");
});

test("citacao aninhada tambem sai", () => {
  assert.equal(soOqueENovo("Confirmed\n>> older\n> old"), "Confirmed");
});

test("um '>' no meio da frase nao e citacao", () => {
  const r = soOqueENovo("Gap > 10cm in the wall, needs filling");
  assert.ok(r.includes("Gap > 10cm"));
});

test("texto sem historico nenhum passa inteiro", () => {
  const corpo = "Job booked for Monday 24 August\nAddress: RM1 4WL\nArrival 09:00-12:00";
  assert.equal(soOqueENovo(corpo), corpo);
});
