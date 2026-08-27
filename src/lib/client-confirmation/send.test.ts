/**
 * O portão que separa "job existe" de "job vai acontecer".
 *
 * Em 26/08/2026 a confirmação saía no NASCIMENTO do job. Um cliente com o job
 * ainda `unassigned` recebeu o `booking_confirmed`, o workflow "Booking -
 * Confirmed" do respond.io moveu o contato para Converted, e ele respondeu
 * "Hi, I would like to cancel this order." Job sem parceiro é job que ainda
 * estamos tentando colocar: confirmar ali promete uma visita que talvez não
 * exista.
 *
 * Estes testes existem porque a regra é invisível no código de quem chama: os
 * três chamadores continuam chamando igual, e só este arquivo prova que o
 * portão está de pé.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarConfirmacaoDoCliente } from "./send";

type Job = Record<string, unknown>;

/**
 * Um supabase de mentira com o mínimo que este caminho toca: ler o job e
 * gravar o motivo do pulo. Se o código passar do portão ele vai pedir
 * `clients`, e aí o fake devolve vazio de propósito — o teste que chegar lá
 * falha por outro motivo, e falhar é o que se quer.
 */
function fakeSupabase(job: Job | null) {
  const gravado: Record<string, unknown>[] = [];
  const client = {
    from(tabela: string) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: tabela === "jobs" ? job : null }) };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          gravado.push({ tabela, ...patch });
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, gravado };
}

const JOB_BASE: Job = {
  id: "job-1",
  reference: "JOB-9999",
  title: "General Maintenance",
  status: "unassigned",
  partner_id: null,
  scheduled_date: "2026-08-28",
  scheduled_start_at: "2026-08-28T07:00:00Z",
  scheduled_end_at: "2026-08-28T11:00:00Z",
  client_id: "cli-1",
  client_name: "Zabel",
  client_confirmation_sent_at: null,
};

describe("confirmação ao cliente: sem parceiro, sem mensagem", () => {
  const antes = process.env.CLIENT_MESSAGING_ENABLED;
  beforeEach(() => {
    process.env.CLIENT_MESSAGING_ENABLED = "1";
  });
  afterEach(() => {
    if (antes === undefined) delete process.env.CLIENT_MESSAGING_ENABLED;
    else process.env.CLIENT_MESSAGING_ENABLED = antes;
  });

  test("job unassigned não fala com o cliente", async () => {
    const { client } = fakeSupabase({ ...JOB_BASE });
    const r = await enviarConfirmacaoDoCliente(client, "job-1");
    assert.equal(r.estado, "pulado");
    assert.match(r.motivo, /no partner assigned/);
  });

  test("o motivo fica gravado no job, não só no log", async () => {
    const { client, gravado } = fakeSupabase({ ...JOB_BASE });
    await enviarConfirmacaoDoCliente(client, "job-1");
    assert.equal(gravado.length, 1);
    assert.equal(gravado[0].tabela, "jobs");
    assert.match(String(gravado[0].client_confirmation_skipped), /no partner assigned/);
  });

  test("o portão do parceiro vem ANTES de procurar o cliente", async () => {
    // Sem client_id E sem parceiro: quem responde é o parceiro. A ordem
    // importa porque "job has no client record" mandaria alguém caçar um
    // cadastro que não é o problema.
    const { client } = fakeSupabase({ ...JOB_BASE, client_id: null });
    const r = await enviarConfirmacaoDoCliente(client, "job-1");
    assert.equal(r.estado, "pulado");
    assert.match(r.motivo, /no partner assigned/);
  });

  test("com parceiro, o portão deixa passar", async () => {
    // Passa do portão e morre adiante, no cliente que este fake não tem. O que
    // se prova aqui é só que a razão do pulo DEIXOU de ser o parceiro.
    const { client } = fakeSupabase({ ...JOB_BASE, partner_id: "p-1", status: "scheduled" });
    const r = await enviarConfirmacaoDoCliente(client, "job-1");
    assert.equal(r.estado, "pulado");
    assert.doesNotMatch(r.motivo, /no partner assigned/);
  });

  test("a trava geral continua vencendo o portão", async () => {
    delete process.env.CLIENT_MESSAGING_ENABLED;
    const { client, gravado } = fakeSupabase({ ...JOB_BASE, partner_id: "p-1" });
    const r = await enviarConfirmacaoDoCliente(client, "job-1");
    assert.equal(r.estado, "pulado");
    assert.match(r.motivo, /CLIENT_MESSAGING_ENABLED/);
    // Desligada, esta função não toca no banco.
    assert.equal(gravado.length, 0);
  });
});
