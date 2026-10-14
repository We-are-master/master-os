import { test } from "node:test";
import assert from "node:assert/strict";
import { escolherTicketDoPedido, modoDeEntrega, ehCanalDeMensagem, emailDoCliente, type CandidatoDoPedido } from "./escolha";

const c = (x: Partial<CandidatoDoPedido> & { id: number }): CandidatoDoPedido => ({ status: "open", canal: "email", origem: "cliente", ...x });

test("o ticket do job ganha de tudo, mesmo resolvido", () => {
  const e = escolherTicketDoPedido([c({ id: 1 }), c({ id: 2, origem: "quote" }), c({ id: 3, origem: "job", status: "solved", canal: "api" })]);
  assert.deepEqual(e, { tipo: "ticket", id: 3, origem: "job", canal: "api", status: "solved" });
});

test("ticket do job fechado (closed) não aceita comentário: cai para a cotação", () => {
  const e = escolherTicketDoPedido([c({ id: 3, origem: "job", status: "closed" }), c({ id: 2, origem: "quote", status: "pending" })]);
  assert.equal(e.tipo === "ticket" && e.id, 2);
});

test("sem vínculo: o aberto mais recente do cliente (B2C)", () => {
  const e = escolherTicketDoPedido([
    c({ id: 10, atualizadoEm: "2026-10-12T10:00:00Z" }),
    c({ id: 11, atualizadoEm: "2026-10-13T10:00:00Z", canal: "whatsapp" }),
    c({ id: 12, status: "solved", atualizadoEm: "2026-10-14T10:00:00Z" }),
  ]);
  assert.deepEqual(e, { tipo: "ticket", id: 11, origem: "cliente", canal: "whatsapp", status: "open" });
});

test("ligação, parceiro e ticket de outro job nunca são o pedido", () => {
  const e = escolherTicketDoPedido([
    c({ id: 1, canal: "voice" }),
    c({ id: 2, tags: ["partner"] }),
    c({ id: 3, ligadoAOutroJob: true }),
  ]);
  assert.deepEqual(e, { tipo: "nenhum" });
});

test("B2B com dois abertos: ambíguo (não chuta)", () => {
  const e = escolherTicketDoPedido([c({ id: 49928 }), c({ id: 51028 })], { b2b: true });
  assert.equal(e.tipo, "ambiguo");
  const um = escolherTicketDoPedido([c({ id: 49928 })], { b2b: true });
  assert.equal(um.tipo === "ticket" && um.id, 49928);
});

test("exigirUnico (criação de job) também não chuta com dois", () => {
  assert.equal(escolherTicketDoPedido([c({ id: 1 }), c({ id: 2 })], { exigirUnico: true }).tipo, "ambiguo");
});

test("o mesmo ticket achado pelo e-mail e pelo telefone conta uma vez", () => {
  const e = escolherTicketDoPedido([c({ id: 5 }), c({ id: 5, canal: "whatsapp" })], { exigirUnico: true });
  assert.equal(e.tipo === "ticket" && e.id, 5);
});

test("modo de entrega: comentário só quando o solicitante é quem recebe e o ticket não é WhatsApp", () => {
  assert.equal(modoDeEntrega({ canal: "email", solicitante: "Ana@x.com", para: "ana@x.com" }), "comentario_publico");
  assert.equal(modoDeEntrega({ canal: "api", solicitante: "ana@x.com", para: "ana@x.com" }), "comentario_publico");
  assert.equal(modoDeEntrega({ canal: "whatsapp", solicitante: "ana@x.com", para: "ana@x.com" }), "conversa_lateral");
  assert.equal(modoDeEntrega({ canal: "native_messaging", solicitante: "ana@x.com", para: "ana@x.com" }), "conversa_lateral");
  // Ticket aberto pelo OS (team@) ou de outra pessoa da conta: o comentário iria para ela.
  assert.equal(modoDeEntrega({ canal: "api", solicitante: "team@getfixfy.com", para: "ana@x.com" }), "conversa_lateral");
  assert.equal(modoDeEntrega({ canal: "email", solicitante: "gerente@conta.com", para: "financeiro@conta.com" }), "conversa_lateral");
  assert.equal(modoDeEntrega({ canal: "email", solicitante: null, para: "ana@x.com" }), "conversa_lateral");
});

test("canais de mensagem", () => {
  assert.ok(ehCanalDeMensagem("whatsapp"));
  assert.ok(ehCanalDeMensagem("sunshine_conversations_api"));
  assert.ok(!ehCanalDeMensagem("email"));
  assert.ok(!ehCanalDeMensagem(null));
});

test("e-mail do cliente: nada da casa nem inválido", () => {
  assert.equal(emailDoCliente(" Eleonora@Gmail.com "), "eleonora@gmail.com");
  assert.equal(emailDoCliente("team@getfixfy.com"), null);
  assert.equal(emailDoCliente("sem-arroba"), null);
  assert.equal(emailDoCliente(null), null);
});

test("ensaio: ignora o próprio ticket e o que nasceu depois", () => {
  const e = escolherTicketDoPedido(
    [c({ id: 1, criadoEm: "2026-10-10T00:00:00Z" }), c({ id: 2, criadoEm: "2026-10-01T00:00:00Z" }), c({ id: 3, criadoEm: "2026-10-12T00:00:00Z" })],
    { excluir: [1], criadoAntesDe: "2026-10-11T00:00:00Z", exigirUnico: true },
  );
  assert.equal(e.tipo === "ticket" && e.id, 2);
});
