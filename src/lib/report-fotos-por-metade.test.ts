import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fotosDaMetade, plannedPhotoShape } from "./report-submission";

const f = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome, { type: "image/jpeg" });

describe("fotosDaMetade", () => {
  test("cada metade fica com as suas, e o nome do slot sai limpo", () => {
    const entries = {
      "start:kitchen": [f("antes-1.jpg")],
      "final:kitchen": [f("depois-1.jpg"), f("depois-2.jpg")],
    };
    const antes = fotosDaMetade(entries, "start");
    const depois = fotosDaMetade(entries, "final");
    assert.deepEqual(Object.keys(antes), ["kitchen"]);
    assert.deepEqual(antes.kitchen!.map((x) => x.name), ["antes-1.jpg"]);
    assert.deepEqual(depois.kitchen!.map((x) => x.name), ["depois-1.jpg", "depois-2.jpg"]);
  });

  test("era isto que duplicava: mesmo cômodo nas duas metades", () => {
    // Antes do conserto o formulário mandava `photos[kitchen][]` nas duas
    // metades, o FormData juntava tudo numa lista e o servidor gravava a lista
    // inteira nos DOIS relatórios.
    const entries = { "start:kitchen": [f("a.jpg")], "final:kitchen": [f("b.jpg")] };
    assert.equal(fotosDaMetade(entries, "start").kitchen!.length, 1);
    assert.equal(fotosDaMetade(entries, "final").kitchen!.length, 1);
  });

  test("chave sem prefixo vale para as duas metades", () => {
    // O formulário do escritório manda assim, e os links já enviados também
    // até o parceiro recarregar a página. Não pode parar de funcionar.
    const entries = { kitchen: [f("x.jpg")] };
    assert.equal(fotosDaMetade(entries, "start").kitchen!.length, 1);
    assert.equal(fotosDaMetade(entries, "final").kitchen!.length, 1);
  });

  test("prefixo e chave nua no mesmo slot somam, sem perder nenhuma", () => {
    const entries = { kitchen: [f("velha.jpg")], "start:kitchen": [f("nova.jpg")] };
    const antes = fotosDaMetade(entries, "start");
    assert.deepEqual(antes.kitchen!.map((x) => x.name).sort(), ["nova.jpg", "velha.jpg"]);
    // No depois entra só a nua: a prefixada é da outra metade.
    assert.deepEqual(fotosDaMetade(entries, "final").kitchen!.map((x) => x.name), ["velha.jpg"]);
  });

  test("mapa vazio continua vazio", () => {
    assert.deepEqual(fotosDaMetade({}, "start"), {});
  });
});

describe("plannedPhotoShape, com as metades separadas", () => {
  test("limpeza: o cômodo do antes não conta no depois", () => {
    const entries = { "start:kitchen": [f("a.jpg")], "final:kitchen": [f("b.jpg"), f("c.jpg")] };
    const antes = plannedPhotoShape("cleaner", "start", entries, null) as Record<string, string[]>;
    const depois = plannedPhotoShape("cleaner", "final", entries, null) as Record<string, string[]>;
    assert.equal(antes.kitchen?.length, 1);
    assert.equal(depois.kitchen?.length, 2);
  });

  test("template plano continua usando before e after", () => {
    const entries = { "start:before": [f("a.jpg")], "final:after": [f("b.jpg")] };
    assert.deepEqual(plannedPhotoShape("default" as never, "start", entries, null), ["pending"]);
    assert.deepEqual(plannedPhotoShape("default" as never, "final", entries, null), ["pending"]);
  });
});
