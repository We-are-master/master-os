/**
 * Job B2C concluído resolve a conversa da /inbox (dono, 10/11/2026).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contatoDoTelefone, decidirResolver } from "./resolver-ao-concluir";

const fim = new Date("2026-11-09T15:00:00Z");
const base = { b2c: true, outroJobAtivo: false, concluidoEm: fim, ultimaEntrada: "2026-11-09T10:00:00Z", conversa: null };

describe("quando resolve", () => {
  it("job B2C concluído, cliente quieto depois: resolve", () => assert.deepEqual(decidirResolver(base), { resolver: true }));
  it("conta B2B: não", () => assert.equal(decidirResolver({ ...base, b2c: false }).resolver, false));
  it("outro job ativo: não", () => assert.equal(decidirResolver({ ...base, outroJobAtivo: true }).resolver, false));
  it("cliente escreveu depois do fim: não", () => assert.equal(decidirResolver({ ...base, ultimaEntrada: "2026-11-09T16:00:00Z" }).resolver, false));
  it("já resolvida depois da conclusão: não repete", () => assert.equal(decidirResolver({ ...base, conversa: { resolvida_em: "2026-11-09T16:00:00Z", arquivada_em: null, excluida_em: null } }).resolver, false));
  it("resolvida antes da conclusão: resolve de novo", () => assert.equal(decidirResolver({ ...base, conversa: { resolvida_em: "2026-11-01T10:00:00Z", arquivada_em: null, excluida_em: null } }).resolver, true));
  it("arquivada: não mexe", () => assert.equal(decidirResolver({ ...base, conversa: { resolvida_em: null, arquivada_em: "2026-11-01T10:00:00Z", excluida_em: null } }).resolver, false));
});

describe("contato da inbox", () => {
  it("07 vira 447", () => assert.equal(contatoDoTelefone("07515 573030"), "447515573030"));
  it("+44 fica", () => assert.equal(contatoDoTelefone("+44 7515 573030"), "447515573030"));
  it("vazio: null", () => assert.equal(contatoDoTelefone(""), null));
});
