import { test } from "node:test";
import assert from "node:assert/strict";
import { camposDaFicha, enderecoDoFormulario, fichaDaFerramenta, janelaDoFormulario } from "./ficha-do-job";

test("a janela dita pelo cliente vira a opção do formulário", () => {
  assert.equal(janelaDoFormulario("9am to 12pm"), "arrival_morning");
  assert.equal(janelaDoFormulario("morning"), "arrival_morning");
  assert.equal(janelaDoFormulario("12pm to 3pm"), "arrival_early_afternoon");
  assert.equal(janelaDoFormulario("13:00 - 15:00"), "arrival_early_afternoon");
  assert.equal(janelaDoFormulario("3pm to 6pm"), "arrival_late_afternoon");
  assert.equal(janelaDoFormulario("6:30pm"), "arrival_evening");
  assert.equal(janelaDoFormulario("8am"), "earlier_morning");
  assert.equal(janelaDoFormulario("whenever"), null);
  assert.equal(janelaDoFormulario(null), null);
});

test("o endereço leva o postcode uma vez só", () => {
  assert.equal(enderecoDoFormulario("12 Strathray Gardens", "nw3 4ny"), "12 Strathray Gardens, NW3 4NY");
  assert.equal(enderecoDoFormulario("12 Strathray Gardens, NW3 4NY", "NW3 4NY"), "12 Strathray Gardens, NW3 4NY");
  assert.equal(enderecoDoFormulario(null, "SE11 5BB"), "SE11 5BB");
  assert.equal(enderecoDoFormulario("", ""), null);
});

test("ficha completa preenche os campos do formulário", () => {
  const campos = camposDaFicha({ nome: "Steven Succar", email: "Steven@Mail.com", telefone: "+447467307398", endereco: "Flat 1, Some Road", postcode: "SE11 5BB", escopo: "Fit 25 converter rings.", preco: 144, tarifa: "hourly", data: "2026-10-16", janela: "9am to 12pm" });
  const por = Object.fromEntries(campos.map((c) => [c.id, c.value]));
  assert.equal(por[5693105918623], "Steven Succar");
  assert.equal(por[5811705681183], "steven@mail.com");
  assert.equal(por[5693026186527], "Flat 1, Some Road, SE11 5BB");
  assert.equal(por[5856894119839], 144);
  assert.equal(por[5807260876063], "job_type_hourly");
  assert.equal(por[5693027123999], "2026-10-16");
  assert.equal(por[5737641586335], "arrival_morning");
});

test("o que o Harvey não sabe fica em branco", () => {
  const campos = camposDaFicha({ nome: "Zoe", data: "Thursday", preco: 0 });
  assert.deepEqual(campos, [{ id: 5693105918623, value: "Zoe" }]);
});

test("preço sem tarifa dita é preço fechado", () => {
  const por = Object.fromEntries(camposDaFicha({ preco: 80 }).map((c) => [c.id, c.value]));
  assert.equal(por[5807260876063], "job_type_fixed");
});

test("a ficha vem do que o modelo mandou na ferramenta", () => {
  assert.equal(fichaDaFerramenta(undefined), null);
  assert.equal(fichaDaFerramenta({}), null);
  const f = fichaDaFerramenta({ customer_name: "Aarish Patel", price: "80", window: "morning" }, { telefone: "+447793563405" });
  assert.equal(f?.nome, "Aarish Patel");
  assert.equal(f?.preco, 80);
  assert.equal(f?.telefone, "+447793563405");
});
