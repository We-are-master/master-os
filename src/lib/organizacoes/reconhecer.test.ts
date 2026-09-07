import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  dominioDe,
  dominioProvaOrganizacao,
  podeAgir,
  reconhecerOrganizacao,
  type OrganizacaoConhecida,
} from "./reconhecer";

/** As organizações reais, com os domínios como estão cadastrados hoje. */
const ORGS: OrganizacaoConhecida[] = [
  { id: "cat", nome: "Checkatrade", dominios: ["checkatrade.com"] },
  { id: "hk", nome: "Housekeep", dominios: ["housekeep.com"] },
  { id: "kv", nome: "Kvadrat LTD", dominios: ["kvadrat.org"] },
  { id: "lf", nome: "Li & Fung", dominios: ["lifung.com"] },
  { id: "ss", nome: "The Stylesmiths", dominios: ["the-stylesmiths.com"] },
  { id: "hz", nome: "Homyze", dominios: ["homyze.com"] },
  { id: "fs", nome: "Fantastic Services", dominios: ["fantasticservices.com"] },
];

describe("dominioDe", () => {
  test("tira o domínio de um endereço", () => {
    assert.equal(dominioDe("mase@kvadrat.org"), "kvadrat.org");
  });

  test("aceita um domínio já sozinho", () => {
    assert.equal(dominioDe("kvadrat.org"), "kvadrat.org");
  });

  test("aceita e-mail inteiro no campo de domínio, que é como a Homyze está no Zendesk", () => {
    assert.equal(dominioDe("alice.pilmoor@homyze.com"), "homyze.com");
  });

  test("normaliza caixa e espaço", () => {
    assert.equal(dominioDe("  Mase@Kvadrat.ORG "), "kvadrat.org");
  });

  test("recusa o lixo que a macro do Zendesk manda quando o campo fica vazio", () => {
    for (const v of ["", "  ", "n/a", "0", "A", null, undefined]) {
      assert.equal(dominioDe(v), null, `deveria recusar ${JSON.stringify(v)}`);
    }
  });
});

describe("reconhecerOrganizacao", () => {
  test("acha a organização pelo domínio, mesmo sem o nome dela no e-mail", () => {
    // "Cupboard fix": o assunto real que o acharConta de hoje não resolve.
    const r = reconhecerOrganizacao("mase@kvadrat.org", ORGS);
    assert.deepEqual(r, { tipo: "organizacao", id: "kv", nome: "Kvadrat LTD", dominio: "kvadrat.org" });
    assert.equal(podeAgir(r), true);
  });

  test("casa por domínio e não por endereço: a Kvadrat cadastrada é mhay@, quem escreve é mase@", () => {
    const r = reconhecerOrganizacao("qualquer.um@kvadrat.org", ORGS);
    assert.equal(r.tipo, "organizacao");
    assert.equal(r.tipo === "organizacao" && r.id, "kv");
  });

  test("aceita subdomínio: eles mandam de cinco endereços diferentes", () => {
    for (const e of ["no-reply@email.checkatrade.com", "x@clicks.checkatrade.com", "y@updates.checkatrade.com"]) {
      const r = reconhecerOrganizacao(e, ORGS);
      assert.equal(r.tipo === "organizacao" && r.id, "cat", `${e} deveria ser Checkatrade`);
    }
  });

  test("não confunde um domínio que só TERMINA parecido", () => {
    // `notcheckatrade.com` não é subdomínio de `checkatrade.com`.
    assert.deepEqual(reconhecerOrganizacao("x@notcheckatrade.com", ORGS), {
      tipo: "desconhecida",
      dominio: "notcheckatrade.com",
    });
  });

  test("nunca age em e-mail pessoal, mesmo de gente de organização conhecida", () => {
    const r = reconhecerOrganizacao("sabrina@gmail.com", ORGS);
    assert.equal(r.tipo, "sem_prova");
    assert.equal(podeAgir(r), false);
  });

  test("nunca age em e-mail nosso: encaminhamento do escritório não é pedido do cliente", () => {
    // O ticket 44664 é exatamente isto: assunto "Li & Fung - Quote Request",
    // requester victor@getfixfy.com. O texto diz Li & Fung; quem mandou fomos nós.
    const r = reconhecerOrganizacao("victor@getfixfy.com", ORGS);
    assert.equal(r.tipo, "sem_prova");
    assert.equal(podeAgir(r), false);
  });

  test("empresa que não é organização nossa fica como desconhecida, não como sem prova", () => {
    const r = reconhecerOrganizacao("jo@umaempresanova.co.uk", ORGS);
    assert.deepEqual(r, { tipo: "desconhecida", dominio: "umaempresanova.co.uk" });
    assert.equal(podeAgir(r), false);
  });

  test("o domínio mais específico ganha quando duas organizações se sobrepõem", () => {
    const orgs: OrganizacaoConhecida[] = [
      { id: "grupo", nome: "Grupo", dominios: ["grupo.com"] },
      { id: "filial", nome: "Filial", dominios: ["uk.grupo.com"] },
    ];
    const a = reconhecerOrganizacao("x@uk.grupo.com", orgs);
    const b = reconhecerOrganizacao("x@grupo.com", orgs);
    assert.equal(a.tipo === "organizacao" && a.id, "filial");
    assert.equal(b.tipo === "organizacao" && b.id, "grupo");
  });

  test("checkatrade.com é de uma organização só (dono, 03/09/2026)", () => {
    // Express deixou de disputar o domínio justamente para este e-mail não ter
    // duas respostas certas.
    assert.equal(ORGS.filter((o) => o.dominios.includes("checkatrade.com")).length, 1);
    const r = reconhecerOrganizacao("rishi.pandya@checkatrade.com", ORGS);
    assert.equal(r.tipo === "organizacao" && r.id, "cat");
  });

  test("sem e-mail nenhum não vira organização", () => {
    assert.equal(podeAgir(reconhecerOrganizacao(null, ORGS)), false);
    assert.equal(podeAgir(reconhecerOrganizacao("", ORGS)), false);
  });
});

describe("dominioProvaOrganizacao", () => {
  test("recusa pessoal e o nosso, para não virarem domínio de cadastro", () => {
    // A conta interna Fixfy tem gmail no contato: gravar isso como domínio de
    // organização transformaria todo remetente do gmail em Fixfy.
    assert.equal(dominioProvaOrganizacao("victorhsouz@gmail.com"), false);
    assert.equal(dominioProvaOrganizacao("victor@getfixfy.com"), false);
    assert.equal(dominioProvaOrganizacao("n/a"), false);
  });

  test("aceita domínio de empresa", () => {
    assert.equal(dominioProvaOrganizacao("sabrinabraz@lifung.com"), true);
    assert.equal(dominioProvaOrganizacao("kvadrat.org"), true);
  });
});
