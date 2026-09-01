import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nomeProprio } from "./nome-proprio";

describe("nomeProprio", () => {
  test("conserta o tudo-minusculo, que e o caso do dono", () => {
    assert.equal(nomeProprio("jahzia delpeche"), "Jahzia Delpeche");
    assert.equal(nomeProprio("grace farnam"), "Grace Farnam");
    assert.equal(nomeProprio("becca zheng"), "Becca Zheng");
  });

  test("conserta o CAPS LOCK, que existe de verdade nesta base", () => {
    assert.equal(nomeProprio("NOEL KENNEDY"), "Noel Kennedy");
    assert.equal(nomeProprio("REBECCA HARVEY"), "Rebecca Harvey");
  });

  test("nome ja escrito direito nao e tocado", () => {
    assert.equal(nomeProprio("Thomas Barton"), "Thomas Barton");
    assert.equal(nomeProprio("Miss Dian"), "Miss Dian");
  });

  /**
   * O ponto mais importante: nome com caixa MISTA foi escolha de alguem, e
   * arrumar por cima quebra os quatro casos abaixo.
   */
  test("caixa mista fica intocada, porque foi decisao de gente", () => {
    assert.equal(nomeProprio("Ronald McDonald"), "Ronald McDonald");
    assert.equal(nomeProprio("Ana de Souza"), "Ana de Souza");
    assert.equal(nomeProprio("Piet van der Berg"), "Piet van der Berg");
    assert.equal(nomeProprio("Sean O'Brien"), "Sean O'Brien");
  });

  test("hifen e apostrofo ganham maiuscula depois", () => {
    assert.equal(nomeProprio("jean-pierre dubois"), "Jean-Pierre Dubois");
    assert.equal(nomeProprio("sean o'brien"), "Sean O'Brien");
    assert.equal(nomeProprio("MARY-JANE D'SOUZA"), "Mary-Jane D'Souza");
  });

  test("Mc vira McDonald, e Mac fica quieto", () => {
    assert.equal(nomeProprio("ronald mcdonald"), "Ronald McDonald");
    // "Macey" nao pode virar "MacEy": Mac abre nome que nao e patronimico.
    assert.equal(nomeProprio("laura macey"), "Laura Macey");
  });

  test("espaco sobrando some, e vazio continua vazio", () => {
    assert.equal(nomeProprio("  ana   maria  "), "Ana Maria");
    assert.equal(nomeProprio(""), "");
    assert.equal(nomeProprio(null), "");
    assert.equal(nomeProprio(undefined), "");
  });

  test("acento nao atrapalha", () => {
    assert.equal(nomeProprio("joão álvares"), "João Álvares");
    assert.equal(nomeProprio("MICHELI ANDRÉ"), "Micheli André");
  });
});
