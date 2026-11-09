/**
 * Macro "Harvey: create job in OS" (dono, 09/11/2026).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { corpoDoJob, faltandoParaCriarJob, fichaDaLateral, juntarFicha, precosDoNossoLado, TAXA_HORA_PADRAO, type FalaDoTicket, type FichaParaJob } from "./macro-criar-job";

const fala = (papel: FalaDoTicket["papel"], texto: string): FalaDoTicket => ({ papel, texto, quando: "2026-11-09T10:00:00Z" });

const completa: FichaParaJob = {
  nome: "Sarah Jones", email: "sarah@example.com", telefone: "+447700900123",
  endereco: "12 Acacia Road, London NW1 4AB", postcode: "NW1 4AB",
  servico: "General Maintenance", catalogServiceId: "cat-1",
  escopo: "Hang 3 curtain poles and fix a loose door handle", tarifa: "hourly",
  preco: 72, horas: 2, data: "2026-11-12", janela: "09:00-12:00", origemDoPreco: "conversa",
};

describe("preço: o Harvey nunca escolhe o número", () => {
  it("só conta £ escrito do nosso lado", () => {
    const c = [fala("cliente", "Can you do it for £50?"), fala("equipe", "It's £72 per hour, 2 hours minimum"), fala("harvey", "Half day is £180")];
    assert.deepEqual(precosDoNossoLado(c).sort((a, b) => a - b), [72, 180]);
  });
  it("preço que o modelo leu e ninguém nosso escreveu cai fora", () => {
    const f = juntarFicha({}, null, { tarifa: "fixed", preco: 50 }, [fala("cliente", "£50 ok?")]);
    assert.equal(f.preco, null);
    assert.ok(faltandoParaCriarJob(f).some((x) => /agreed price/.test(x)));
  });
  it("preço escrito pela equipe fica", () => {
    const f = juntarFicha({}, null, { tarifa: "fixed", preco: 230 }, [fala("equipe", "That would be £230 all in")]);
    assert.equal(f.preco, 230);
    assert.equal(f.origemDoPreco, "conversa");
  });
  it("por hora sem taxa escrita usa a régua de £72/h e avisa", () => {
    const f = juntarFicha({}, null, { tarifa: "hourly" }, []);
    assert.equal(f.preco, TAXA_HORA_PADRAO);
    assert.equal(f.origemDoPreco, "padrao");
  });
});

describe("lateral > quote > conversa", () => {
  it("a lateral ganha da conversa", () => {
    const lateral = fichaDaLateral([
      { id: 5693105918623, value: "Sarah Jones" },
      { id: 5856894119839, value: "150" },
      { id: 5807260876063, value: "job_type_fixed" },
      { id: 5687087915551, value: "os_cat-9" },
    ]);
    const f = juntarFicha(lateral, null, { nome: "Sara", tarifa: "hourly", preco: 72, catalogServiceId: "cat-1" }, [fala("equipe", "£72 per hour")]);
    assert.equal(f.nome, "Sarah Jones");
    assert.equal(f.tarifa, "fixed");
    assert.equal(f.preco, 150);
    assert.equal(f.origemDoPreco, "lateral");
    assert.equal(f.catalogServiceId, "cat-9");
  });
  it("quote do ticket dá preço e escopo", () => {
    const f = juntarFicha({}, { preco: 480, escopo: "Paint the living room walls and ceiling", servico: "Painting", catalogServiceId: "cat-p", endereco: null, postcode: null }, { escopo: "paint" }, []);
    assert.equal(f.preco, 480);
    assert.equal(f.origemDoPreco, "quote");
    assert.equal(f.escopo, "Paint the living room walls and ceiling");
  });
});

describe("o que falta para o job nascer", () => {
  it("ficha completa: nada", () => assert.deepEqual(faltandoParaCriarJob(completa), []));
  it("só postcode não é endereço", () => {
    assert.ok(faltandoParaCriarJob({ ...completa, endereco: "NW1 4AB" }).some((x) => /full address/.test(x)));
  });
  it("sem data vira Date TBC, sem travar", () => {
    assert.deepEqual(faltandoParaCriarJob({ ...completa, data: null, janela: null }), []);
  });
  it("data sem janela trava", () => {
    assert.ok(faltandoParaCriarJob({ ...completa, janela: null }).includes("arrival window"));
  });
  it("sem serviço do catálogo trava", () => {
    assert.ok(faltandoParaCriarJob({ ...completa, catalogServiceId: null }).includes("service type"));
  });
});

describe("corpo do POST /api/jobs", () => {
  const a = { accountId: "acc", ticketId: 52280, images: ["https://x/1.jpg"], quemAplicou: "Victor" };
  it("por hora: taxa e horas, no ticket da conversa, com fotos", () => {
    const b = corpoDoJob(completa, a);
    assert.equal(b.rate_type, "hourly");
    assert.equal(b.hourly_client_rate, 72);
    assert.equal(b.billed_hours, 2);
    assert.equal(b.ticket_id, 52280);
    assert.deepEqual(b.images, ["https://x/1.jpg"]);
    assert.equal(b.client_price, undefined);
  });
  it("nada vai ao cliente e nenhum ticket novo", () => {
    const b = corpoDoJob(completa, a);
    assert.equal(b.customer_message_html, undefined);
    assert.equal(b.create_zendesk_ticket, undefined);
    assert.match(String(b.internal_notes), /Nothing was sent to the customer/);
  });
  it("sem data: date_tbc", () => {
    const b = corpoDoJob({ ...completa, data: null, janela: null }, a);
    assert.equal(b.date_tbc, true);
    assert.equal(b.date, undefined);
  });
  it("fixo: client_price", () => {
    const b = corpoDoJob({ ...completa, tarifa: "fixed", preco: 230 }, a);
    assert.equal(b.client_price, 230);
    assert.equal(b.hourly_client_rate, undefined);
  });
  it("escopo sem preço", () => {
    assert.doesNotMatch(String(corpoDoJob(completa, a).description), /£/);
  });
});
