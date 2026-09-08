import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ehDocumentoDoCertificado } from "./certificado-anexado";

describe("ehDocumentoDoCertificado", () => {
  test("os certificados de verdade passam, e nenhum tem a palavra no nome", () => {
    // Os dois que já foram arquivados certo, #50069 e #50072. Vêm nomeados pelo
    // ENDEREÇO, então exigir a palavra "certificate" recusaria os dois.
    assert.deepEqual(
      ehDocumentoDoCertificado("31 Ardleigh Road London E17 5BU (K88078).pdf", "EICR Report"),
      { arquivar: true },
    );
    assert.deepEqual(
      ehDocumentoDoCertificado(
        "Flat 52 Basildon Court 28 Devonshire Street London W1G 6PR (K88061) (1).pdf",
        "EICR Report",
      ),
      { arquivar: true },
    );
  });

  test("a fatura que virou laudo do JOB-9618 é recusada pelo nome", () => {
    const r = ehDocumentoDoCertificado(
      "Landlord Certification Invoice #2394.pdf",
      "Masters, your booking with Landlord Certification is confirmed - Invoice Attached",
    );
    assert.deepEqual(r, { arquivar: false, motivo: "cobranca_no_nome" });
  });

  test("fatura com nome genérico é pega pelo assunto", () => {
    const r = ehDocumentoDoCertificado("document.pdf", "Your invoice for job at E17 5BU");
    assert.deepEqual(r, { arquivar: false, motivo: "cobranca_no_assunto" });
  });

  test("confirmação de agendamento não traz laudo: o trabalho nem foi feito", () => {
    const r = ehDocumentoDoCertificado("booking.pdf", "Your booking with us is confirmed");
    assert.deepEqual(r, { arquivar: false, motivo: "agendamento" });
  });

  test("os outros papéis de cobrança também ficam de fora", () => {
    for (const nome of [
      "Receipt 8891.pdf",
      "Quotation for EICR.pdf",
      "Remittance advice.pdf",
      "Credit Note 12.pdf",
      "Purchase Order 55.pdf",
      "Proforma 3.pdf",
    ]) {
      assert.equal(ehDocumentoDoCertificado(nome, "EICR Report").arquivar, false, `deveria recusar ${nome}`);
    }
  });

  test("palavra dentro de outra não conta", () => {
    // "Invoiced" e "Requote" não são o documento; a busca é por palavra solta.
    assert.equal(ehDocumentoDoCertificado("Reinvoiced.pdf", "EICR Report").arquivar, true);
    assert.equal(ehDocumentoDoCertificado("31 Quoteley Road W1 2AB.pdf", "EICR Report").arquivar, true);
  });

  test("assunto vazio não impede o certificado de entrar", () => {
    assert.equal(ehDocumentoDoCertificado("11 Meadowview Road SE6 3NL.pdf", "").arquivar, true);
  });
});
