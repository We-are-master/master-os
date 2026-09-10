import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteParaParceiro, CLIENTE_PARA_PARCEIRO } from "./quote-para-parceiro";

const CONTAS = ["Housekeep", "Checkatrade", "Good Place Lettings", "Express"];

test("o nome do cliente nunca sai, venha o que vier", () => {
  for (const nome of ["Housekeep", "Yosheeta (Housekeep Support)", "Eric Allen", "", null]) {
    const r = quoteParaParceiro({ title: "Painter", client_name: nome } as never, { nomesProibidos: CONTAS });
    assert.equal(r.clientName, CLIENTE_PARA_PARCEIRO);
  }
});

test("carimbo de origem sai do titulo e o trabalho fica", () => {
  const r = quoteParaParceiro(
    { title: "[Housekeep] Quote Request – Wallpapering Feature Wall (NW8 9LD)" },
    { nomesProibidos: CONTAS },
  );
  assert.equal(r.typeOfWork, "Quote Request – Wallpapering Feature Wall (NW8 9LD)");
});

test("nome solto no meio do titulo sai sem deixar pontuacao orfa", () => {
  const r = quoteParaParceiro({ title: "Housekeep - Painter" }, { nomesProibidos: CONTAS });
  assert.equal(r.typeOfWork, "Painter");
});

test("titulo que era so o nome da conta vira o ultimo caso, nunca vazio", () => {
  const r = quoteParaParceiro({ title: "Housekeep" }, { nomesProibidos: CONTAS });
  assert.equal(r.typeOfWork, "Quote");
});

test("titulo limpo passa intacto", () => {
  const r = quoteParaParceiro({ service_type: "Painter", title: "Ceiling repair" }, { nomesProibidos: CONTAS });
  assert.equal(r.typeOfWork, "Painter");
});

test("o scope perde a linha que cita a conta e mantem o trabalho", () => {
  const r = quoteParaParceiro(
    { title: "Painter", scope: "This is a Housekeep job.\nRepaint the ceiling, 3m x 4m.\nTwo coats." },
    { nomesProibidos: CONTAS },
  );
  assert.equal(r.scope, "Repaint the ceiling, 3m x 4m.\nTwo coats.");
});

test("o scope da opcao ganha do scope da quote (a porta e quem resolve)", () => {
  const r = quoteParaParceiro(
    { title: "Painter", scope: "scope da quote" },
    { scope: "descricao do request", nomesProibidos: CONTAS },
  );
  assert.equal(r.scope, "descricao do request");
});

test("sem lista de nomes as plataformas conhecidas ainda saem do scope", () => {
  const r = quoteParaParceiro({ title: "Painter", scope: "Booked via Checkatrade.\nFix the door." });
  assert.equal(r.scope, "Fix the door.");
});

test("conta nova entra pela lista e e tratada como as antigas", () => {
  const r = quoteParaParceiro(
    { title: "[Acme Lettings] Painter", scope: "Acme Lettings sent this.\nPaint the hall." },
    { nomesProibidos: ["Acme Lettings"] },
  );
  assert.equal(r.typeOfWork, "Painter");
  assert.equal(r.scope, "Paint the hall.");
});

test("scope vazio vira string vazia, nunca null, para a porta nao imprimir 'null'", () => {
  const r = quoteParaParceiro({ title: "Painter", scope: null }, { nomesProibidos: CONTAS });
  assert.equal(r.scope, "");
});
