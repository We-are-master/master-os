import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCustomerGreetingName } from "@/lib/zendesk-job-confirmation";

/**
 * O caso real: em 24/08/2026 o cancelamento do JOB-9491 chegou em
 * hello@housekeep.com dizendo "Hi Julian". Julian é o morador; quem recebe a
 * nota pública do ticket é a conta que abriu o ticket.
 *
 * Os avisos terminais (cancelado, concluído, cotação recusada) não resolviam a
 * organização — só o aviso de criação resolvia. Agora os quatro passam por aqui.
 */
describe("saudação dos avisos de ticket", () => {
  it("job de conta cumprimenta a conta, nunca o morador", () => {
    assert.equal(resolveCustomerGreetingName("Housekeep", "Julian Bajada"), "Housekeep");
  });

  it("nome de organização vai inteiro, sem virar primeiro nome", () => {
    // "Hi Fantastic" seria errado: o nome da empresa é o nome dela toda.
    assert.equal(resolveCustomerGreetingName("Fantastic Services", "Julian Bajada"), "Fantastic Services");
  });

  it("sem conta é B2C: primeiro nome do cliente", () => {
    assert.equal(resolveCustomerGreetingName(null, "Julian Bajada"), "Julian");
  });

  it("organização em branco não conta como organização", () => {
    assert.equal(resolveCustomerGreetingName("   ", "Julian Bajada"), "Julian");
  });

  it("sem nome nenhum, saudação genérica", () => {
    assert.equal(resolveCustomerGreetingName(null, ""), "there");
  });
});
