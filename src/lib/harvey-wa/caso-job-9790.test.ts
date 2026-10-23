/**
 * O caso do Frede (dono, 23/10/2026): lead do Checkatrade, suporte de bicicleta,
 * QT-2026-1256 → JOB-9790, tickets #51652 (lead) e #51653 (WhatsApp).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { precoDoCatalogoJaDado } from "./pedido-de-cotacao";
import { esperaDeVerdade } from "./painel";
import { lancesParaRecusar } from "@/lib/quotes/fechar-quote-convertida";
import { formularioDoJobFaltando } from "@/lib/zendesk-espelho";

const HORA = "That's a blown bit of plaster round the fixing, but still a small handyman job. It's £72 fixed for the hour, tools included, materials not included.";

describe("hora do catálogo ou cotação de parceiro, nunca as duas", () => {
  it("21/10 13:51: depois de 'a handyman hour is £72' o request_quote recusa", () => {
    const conversa = [
      { papel: "cliente", texto: "I'll send photos" },
      { papel: "harvey", texto: "That looks like the bracket's pulled out of the wall. A handyman hour is £72 fixed, tools included." },
    ];
    assert.equal(precoDoCatalogoJaDado(conversa, false), true);
  });

  it("preço por hora dado nesta mesma resposta (get_quote) também conta", () => {
    assert.equal(precoDoCatalogoJaDado([], true), true);
  });

  it("os outros jeitos de dizer a hora", () => {
    for (const texto of [HORA, "Half day is £180 for that.", "£329 for a full day, materials at cost.", "We charge by the hour: £72."]) {
      assert.equal(precoDoCatalogoJaDado([{ papel: "harvey", texto }], false), true, texto);
    }
  });

  it("cliente pede uma quote depois da hora: vale de novo", () => {
    const conversa = [
      { papel: "harvey", texto: HORA },
      { papel: "cliente", texto: "Can you give me a fixed price quote instead?" },
    ];
    assert.equal(precoDoCatalogoJaDado(conversa, false), false);
  });

  it("sem preço por tempo na conversa: request_quote segue normal", () => {
    const conversa = [
      { papel: "harvey", texto: "That's a leak behind the tiles, we'd need a proper quote. Would you like one?" },
      { papel: "cliente", texto: "Yes please" },
    ];
    assert.equal(precoDoCatalogoJaDado(conversa, false), false);
    // £ sem hora (preço de projeto "from") não trava.
    assert.equal(precoDoCatalogoJaDado([{ papel: "harvey", texto: "Bathrooms start from £5,500 labour." }], false), false);
  });

  it("o que a equipe ou o cliente dizem com £ e hora não conta como oferta do Harvey", () => {
    assert.equal(precoDoCatalogoJaDado([{ papel: "cliente", texto: "Someone quoted me £50 an hour" }], false), false);
  });
});

describe("a quote virou job: os lances que sobram fecham", () => {
  const lances = [
    { id: "whistyle", partner_id: "p-whistyle", status: "submitted" },
    { id: "outro", partner_id: "p-outro", status: "approved" },
    { id: "ja-recusado", partner_id: "p-x", status: "rejected" },
  ];

  it("JOB-9790 nasceu sem parceiro (reserva da hora): o lance da WHistyle é recusado", () => {
    assert.deepEqual(lancesParaRecusar(lances, null), ["whistyle"]);
  });

  it("o lance do parceiro do job fica", () => {
    assert.deepEqual(lancesParaRecusar(lances, "p-whistyle"), []);
    assert.deepEqual(lancesParaRecusar([{ id: "a", partner_id: "p1", status: "submitted" }, { id: "b", partner_id: "p2", status: "submitted" }], "p1"), ["b"]);
  });

  it("aprovado e já recusado não mudam", () => {
    assert.deepEqual(lancesParaRecusar(lances.filter((l) => l.status !== "submitted"), null), []);
  });
});

describe("o formulário do job no ticket da conversa", () => {
  const base = { status: "open", supportType: "agent", jobIdNoTicket: null, referencia: "JOB-9790" };

  it("#51653 com o Job ID vazio depois de virar ticket normal: preenche", () => {
    assert.equal(formularioDoJobFaltando(base), true);
    assert.equal(formularioDoJobFaltando({ ...base, jobIdNoTicket: "" }), true);
  });

  it("enquanto é AI agent (só leitura) não tenta: o Zendesk recusa", () => {
    assert.equal(formularioDoJobFaltando({ ...base, supportType: "ai_agent" }), false);
  });

  it("ticket closed não aceita nada", () => {
    assert.equal(formularioDoJobFaltando({ ...base, status: "closed" }), false);
  });

  it("Job ID já preenchido (mesmo de outro job do ticket) não é trocado", () => {
    assert.equal(formularioDoJobFaltando({ ...base, jobIdNoTicket: "JOB-9790" }), false);
    assert.equal(formularioDoJobFaltando({ ...base, jobIdNoTicket: "JOB-9791" }), false);
  });

  it("job sem referência não tem o que escrever", () => {
    assert.equal(formularioDoJobFaltando({ ...base, referencia: null }), false);
  });
});

describe("rede de segurança: o Harvey respondeu de verdade?", () => {
  const agora = new Date("2026-10-23T15:44:00Z");

  it("#51653: cliente 11:57, Harvey 11:58. Ticket dizia 24 min de espera: não é espera", () => {
    assert.equal(esperaDeVerdade({ cliente_em: "2026-10-23T11:57:47Z", harvey_em: "2026-10-23T11:58:25Z" }, 24, agora), null);
  });

  it("cliente escreveu e o Harvey não respondeu há 30 min: espera, contada da mensagem do cliente", () => {
    assert.equal(esperaDeVerdade({ cliente_em: "2026-10-23T15:14:00Z", harvey_em: "2026-10-23T11:58:25Z" }, 5, agora), 30);
  });

  it("espera de verdade abaixo do limite: ainda não", () => {
    assert.equal(esperaDeVerdade({ cliente_em: "2026-10-23T15:34:00Z", harvey_em: null }, 40, agora), null);
  });

  it("sem dados da conversa: vale o ticket, como antes", () => {
    assert.equal(esperaDeVerdade(null, 24, agora), 24);
    assert.equal(esperaDeVerdade(null, 10, agora), null);
    assert.equal(esperaDeVerdade({ cliente_em: null, harvey_em: null }, 30, agora), 30);
  });
});
