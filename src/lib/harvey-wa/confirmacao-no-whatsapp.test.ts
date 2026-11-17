import assert from "node:assert/strict";
import { test } from "node:test";
import { textoDaConfirmacao, textoDePagamentoRecebido } from "./confirmacao-no-whatsapp";

const SEM_TRAVESSAO = /[–—]/;

test("com janela: dia, janela, serviço, endereço e referência, primeiro nome", () => {
  assert.equal(
    textoDaConfirmacao({ nome: "Jake Carr", dia: "Wed 21 Oct 26", janela: "9:00 AM – 12:00 PM", referencia: "JOB-9750", servico: "Handyman", endereco: "12 Example Road, London E1 6AN" }),
    "Hi Jake,\n\nYour Fixfy booking is confirmed for Wed 21 Oct 26, arriving 09:00-12:00. Your professional is confirmed for Handyman at 12 Example Road, London E1 6AN. If anything changes, just reply here. Reference: JOB-9750.",
  );
});

test("data curta antiga e janela já no formato novo", () => {
  const t = textoDaConfirmacao({ nome: null, dia: "2026-10-21", janela: "between 9am and midday", referencia: "JOB-9750" });
  assert.match(t, /^Hi there,\n\nYour Fixfy booking is confirmed for Wed 21 Oct 26, arriving 09:00-12:00\./);
});

test("sem janela não diz 'between To be confirmed'", () => {
  const t = textoDaConfirmacao({ nome: null, dia: "Tuesday 21 October", janela: "To be confirmed", referencia: "JOB-9750" });
  assert.doesNotMatch(t, /between/);
  assert.match(t, /We’ll confirm the arrival time/);
  assert.doesNotMatch(t, SEM_TRAVESSAO);
  assert.doesNotMatch(t, /\{\{/);
});

test("pagamento total: valor pago e referência, sem prometer profissional", () => {
  const t = textoDePagamentoRecebido({ nome: "Sarah Jones", referencia: "JOB-9800", deposito: false, total: 180, sinal: 180 });
  assert.equal(t, "Hi Sarah,\n\nThank you, we’ve received your payment of £180.00 for booking JOB-9800, and your booking has been created. We’ll keep you updated on the booking arrangements here. If you have a question, just reply.");
});

test("sinal: valor do sinal e o saldo calculado", () => {
  const t = textoDePagamentoRecebido({ nome: null, referencia: "JOB-9800", deposito: true, total: 180, sinal: 90 });
  assert.equal(t, "Hi there,\n\nThank you, we’ve received your £90.00 deposit for booking JOB-9800, and your booking has been created. The remaining £90.00 is due after the work is complete. We’ll keep you updated on the booking arrangements here.");
});

test("sinal sem valor gravado não inventa número", () => {
  const t = textoDePagamentoRecebido({ nome: "Sarah", referencia: null, deposito: true, total: 180, sinal: null });
  assert.doesNotMatch(t, /£/);
  assert.doesNotMatch(t, SEM_TRAVESSAO);
});

test("primeira compra: linha de outros serviços, nunca o que comprou", async () => {
  const { tipoDoServico } = await import("./confirmacao-no-whatsapp");
  const t = textoDePagamentoRecebido({ nome: "Sarah", referencia: "FX-K7Q2M9", deposito: true, total: 144, sinal: 72, outrosServicos: tipoDoServico("Handyman: TV mounting and 2 shelves") });
  assert.match(t, /\n\nJust so you know, we also take care of cleaning and property certificates such as gas safety and EICRs, so if there’s anything else you need, do get in touch\.$/);
  assert.equal(tipoDoServico("End of Tenancy Clean, 2 bed"), "limpeza");
  assert.equal(tipoDoServico("Gas Safety Certificate (CP12)"), "certificado");
  assert.equal(tipoDoServico("Painting: living room"), "pintura");
  assert.doesNotMatch(textoDePagamentoRecebido({ nome: null, referencia: null, deposito: false, total: 200, sinal: 200, outrosServicos: "limpeza" }), /cleaning/);
  assert.doesNotMatch(textoDePagamentoRecebido({ nome: null, referencia: null, deposito: false, total: 200, sinal: 200 }), /Just so you know/);
  assert.doesNotMatch(t, SEM_TRAVESSAO);
});
