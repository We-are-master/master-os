import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { postcodesNoTexto, referenciasNoTexto } from "./achar-job";

/**
 * Só as duas funções puras. O `acharJobDoTicket` fala com o banco e é
 * conferido contra os tickets reais pelo `scripts/harvey-achar-job.mts`, que é
 * ensaio e não escreve nada.
 */

describe("postcodesNoTexto", () => {
  test("acha no assunto do reschedule, que é onde ele mora", () => {
    // Os cinco formatos de assunto que a Housekeep já usou.
    assert.deepEqual(postcodesNoTexto("[Housekeep] Reschedule Carpenter: E1 3AQ"), ["E13AQ"]);
    assert.deepEqual(postcodesNoTexto("[Housekeep] Reschedule — E10 7AL on 17/08/2026"), ["E107AL"]);
    assert.deepEqual(postcodesNoTexto("[Housekeep] Reschedule Job: RM7 0FJ"), ["RM70FJ"]);
    assert.deepEqual(postcodesNoTexto("Reschedule for SE4 2DT - Handyman Job"), ["SE42DT"]);
    assert.deepEqual(
      postcodesNoTexto("Reschedule for Install Digital Sink Faucet & Unplug Boiler in EC1V 0AA"),
      ["EC1V0AA"],
    );
  });

  test("acha no corpo do certificado e no nome do PDF anexado", () => {
    // Ticket 50069, palavra por palavra.
    assert.deepEqual(
      postcodesNoTexto("the EICR report for the property at: 31 Ardleigh Road London E17 5BU"),
      ["E175BU"],
    );
    assert.deepEqual(postcodesNoTexto("31 Ardleigh Road London E17 5BU (K88078).pdf"), ["E175BU"]);
    // Ticket 50072: postcode longo, dentro de um endereço comprido.
    assert.deepEqual(
      postcodesNoTexto("Flat 52 Basildon Court 28 Devonshire Street London W1G 6PR (K88061) (1).pdf"),
      ["W1G6PR"],
    );
  });

  test("com ou sem espaço dá a mesma chave", () => {
    assert.deepEqual(postcodesNoTexto("E175BU"), postcodesNoTexto("E17 5BU"));
    assert.deepEqual(postcodesNoTexto("e17 5bu"), ["E175BU"]);
  });

  test("não inventa postcode a partir de referência do parceiro", () => {
    // "(K88078)" é o número deles, não é postcode.
    assert.deepEqual(postcodesNoTexto("report (K88078) attached"), []);
    assert.deepEqual(postcodesNoTexto("thread::luBGIj-3AxG29OKqaqMq3hU::"), []);
  });

  test("texto sem postcode devolve vazio, e isso não é erro", () => {
    assert.deepEqual(postcodesNoTexto("Good morning, please advise"), []);
    assert.deepEqual(postcodesNoTexto(null), []);
  });

  test("dois postcodes diferentes viram dois, e quem chama decide", () => {
    const r = postcodesNoTexto("moved from E1 3AQ to E17 5BU");
    assert.equal(r.length, 2);
    assert.ok(r.includes("E13AQ") && r.includes("E175BU"));
  });
});

describe("referenciasNoTexto", () => {
  test("acha a referência do OS no assunto", () => {
    assert.deepEqual(
      referenciasNoTexto("JOB-9617 · (EICR) Electrical Installation Condition Report · Wayne M"),
      ["JOB-9617"],
    );
  });

  test("normaliza a caixa e não repete", () => {
    assert.deepEqual(referenciasNoTexto("job-9617 e de novo JOB-9617"), ["JOB-9617"]);
  });

  test("duas referências diferentes viram duas — ambiguidade não vira ação", () => {
    assert.deepEqual(referenciasNoTexto("JOB-9617 and JOB-9618"), ["JOB-9617", "JOB-9618"]);
  });

  test("sem referência devolve vazio", () => {
    assert.deepEqual(referenciasNoTexto("[Housekeep] Reschedule Carpenter: E1 3AQ"), []);
  });
});
