import { test } from "node:test";
import assert from "node:assert/strict";
import { PADRAO, modoEfetivo, tetoDoAmbiente, validarAutonomia } from "./autonomia";

function comAmbiente(vars: Record<string, string | undefined>, fn: () => void) {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("sem linha no banco vale o padrão: o que existia segue a variável, o novo em ensaio", () => {
  const a = validarAutonomia(null);
  assert.deepEqual(a, PADRAO);
  assert.equal(a.areas.cotacao, "on");
  assert.equal(a.areas.b2b_hora, "ensaio");
});

test("lixo vira padrão e o teto absurdo é ignorado", () => {
  const a = validarAutonomia({ geral: "sim", areas: { envio: "talvez", aceite: "on" }, tetoEnvio: -5 });
  assert.equal(a.geral, true);
  assert.equal(a.areas.envio, "on");
  assert.equal(a.areas.aceite, "on");
  assert.equal(a.tetoEnvio, null);
});

test("Pausar tudo desliga toda área", () => {
  comAmbiente({ HARVEY_QUOTE_INVITES: "1", HARVEY_PAUSADO: undefined }, () => {
    const a = validarAutonomia({ geral: false });
    assert.equal(modoEfetivo(a, "cotacao"), "off");
    assert.equal(modoEfetivo(a, "b2b_hora"), "off");
  });
});

test("a variável é teto: a tela não passa dela", () => {
  comAmbiente({ HARVEY_QUOTE_AUTO_SEND: undefined, HARVEY_RASCUNHO_LANCE: undefined, HARVEY_QUOTE_INVITES: "1", HARVEY_PAUSADO: undefined }, () => {
    const a = validarAutonomia({ areas: { envio: "on", lances: "on", cotacao: "ensaio" } });
    assert.equal(modoEfetivo(a, "envio"), "ensaio");
    assert.equal(modoEfetivo(a, "lances"), "off");
    assert.equal(modoEfetivo(a, "cotacao"), "ensaio");
  });
});

test("HARVEY_PAUSADO=1 desliga tudo, como antes", () => {
  comAmbiente({ HARVEY_PAUSADO: "1" }, () => {
    assert.equal(tetoDoAmbiente("perguntas"), "off");
  });
});
