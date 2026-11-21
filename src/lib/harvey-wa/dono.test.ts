/**
 * Dono da conversa (dono, 10/11/2026): HARVEY_DONO_POR_AGENTE desligada fica igual a hoje;
 * ligada, o Give back volta ao agente dono, o relógio não devolve e o book_team_price só
 * fecha depois do Give back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agenteDoMotivo,
  comAgente,
  donoDaConversa,
  donoPorAgenteLigado,
  motivoComDono,
  podeFecharPeloPrecoDaEquipe,
  precoDaEquipeDevolveAConversa,
  semAgente,
  tempoDevolveAConversa,
} from "./dono";
import { devolvidaEm, motivoDaDevolucao } from "./equipe-dona";

test("a porta só liga com 1", () => {
  assert.equal(donoPorAgenteLigado(undefined), false);
  assert.equal(donoPorAgenteLigado(""), false);
  assert.equal(donoPorAgenteLigado("0"), false);
  assert.equal(donoPorAgenteLigado("true"), false);
  assert.equal(donoPorAgenteLigado("1"), true);
  assert.equal(donoPorAgenteLigado(" 1 "), true);
});

test("sem marca o dono é o Harvey; com marca, o agente marcado", () => {
  assert.equal(agenteDoMotivo(null), "harvey");
  assert.equal(agenteDoMotivo("Ana took over"), "harvey");
  assert.equal(agenteDoMotivo("Ana took over [agent:alex]"), "alex");
  assert.equal(agenteDoMotivo("[agent:alex]"), "alex");
  // Marca desconhecida não inventa agente.
  assert.equal(agenteDoMotivo("Ana took over [agent:bob]"), "harvey");
});

test("comAgente: o Harvey não leva marca, o Alex leva uma só", () => {
  assert.equal(comAgente("Ana took over", "harvey"), "Ana took over");
  assert.equal(comAgente(null, "harvey"), null);
  assert.equal(comAgente("Ana took over", "alex"), "Ana took over [agent:alex]");
  assert.equal(comAgente("Ana took over [agent:alex]", "alex"), "Ana took over [agent:alex]");
  assert.equal(comAgente(null, "alex"), "[agent:alex]");
  assert.equal(semAgente("Ana took over [agent:alex]"), "Ana took over");
  assert.equal(semAgente(null), null);
});

test("porta DESLIGADA: o motivo sai exatamente como hoje, mesmo com marca antiga no banco", () => {
  assert.equal(motivoComDono("Ana took over", null, false), "Ana took over");
  assert.equal(motivoComDono("Ana took over", "Harvey handed off [agent:alex]", false), "Ana took over");
  assert.equal(motivoComDono(null, "x [agent:alex]", false), null);
  assert.equal(tempoDevolveAConversa(false), true);
  assert.equal(precoDaEquipeDevolveAConversa(false), true);
  assert.equal(podeFecharPeloPrecoDaEquipe(undefined, false), true);
  assert.equal(podeFecharPeloPrecoDaEquipe(false, false), true);
});

test("porta LIGADA: Take over e Give back carregam o agente que era dono", () => {
  // Alex atendia: Take over guarda o Alex...
  const assumida = motivoComDono("Ana took over", "[agent:alex]", true);
  assert.equal(assumida, "Ana took over [agent:alex]");
  assert.equal(donoDaConversa({ estado: "equipe", motivo_passagem: assumida }), "equipe");
  // ...e o Give back volta para o Alex, com a marca da pessoa que devolveu.
  const devolvida = motivoComDono(motivoDaDevolucao("Ana", new Date("2026-11-10T10:00:00Z")), assumida, true);
  assert.equal(devolvida, "given back by Ana at 2026-11-10T10:00:00.000Z [agent:alex]");
  assert.equal(donoDaConversa({ estado: "harvey", motivo_passagem: devolvida }), "alex");
  // Harvey atendia: nada de marca, volta Harvey.
  assert.equal(motivoComDono("Ana took over", null, true), "Ana took over");
  assert.equal(donoDaConversa({ estado: "harvey", motivo_passagem: motivoComDono(motivoDaDevolucao("Ana"), "Ana took over", true) }), "harvey");
  assert.equal(donoDaConversa(null), "harvey");
  assert.equal(donoDaConversa({ estado: "parado" }), "parado");
});

test("porta LIGADA: o relógio não devolve e o preço da equipe não devolve sozinho", () => {
  assert.equal(tempoDevolveAConversa(true), false);
  assert.equal(precoDaEquipeDevolveAConversa(true), false);
});

test("porta LIGADA: book_team_price só depois do Give back de uma pessoa", () => {
  assert.equal(podeFecharPeloPrecoDaEquipe(undefined, true), false);
  assert.equal(podeFecharPeloPrecoDaEquipe(false, true), false);
  assert.equal(podeFecharPeloPrecoDaEquipe(true, true), true);
});

test("devolvidaEm lê a hora do Give back com ou sem a marca do agente", () => {
  const em = new Date("2026-11-10T10:00:00Z");
  assert.equal(devolvidaEm(motivoDaDevolucao("Ana", em)), em.getTime());
  assert.equal(devolvidaEm(`${motivoDaDevolucao("Ana", em)} [agent:alex]`), em.getTime());
  assert.equal(devolvidaEm("[agent:alex]"), null);
  assert.equal(devolvidaEm("team owns the chat: Ana wrote at x [agent:alex]"), null);
});
