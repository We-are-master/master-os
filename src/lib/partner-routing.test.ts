import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PARTNER_DAILY_CAP, PARTNER_ROUTES, routePartnerForJob } from "./partner-routing";

const GENERAL_MAINTENANCE = "f31ba2ac-fd22-4961-9081-98e64e4b5c95";
const EICR = "e0cbd852-c10c-4aac-b52c-dfd274b65848";
const CARPENTER = "70c96d0e-da0f-495a-8d6d-c2a885dd6010";

/** Supabase falso: só o suficiente para a contagem do teto. */
function fakeSupabase(resultado: { count?: number; error?: { message: string } }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => Promise.resolve(resultado),
  };
  return { from: () => chain } as never;
}

test("serviço sem parceiro nomeado fica manual", async () => {
  const r = await routePartnerForJob(fakeSupabase({ count: 0 }), {
    catalogServiceId: CARPENTER,
    scheduledDate: "2026-08-20",
  });
  assert.equal(r.routed, false);
  assert.equal(r.routed === false && r.reason, "no_route");
});

test("job sem data agendada não é roteado", async () => {
  const r = await routePartnerForJob(fakeSupabase({ count: 0 }), {
    catalogServiceId: GENERAL_MAINTENANCE,
    scheduledDate: null,
  });
  assert.equal(r.routed, false);
});

test("abaixo do teto, roteia para o parceiro do serviço", async () => {
  const r = await routePartnerForJob(fakeSupabase({ count: 4 }), {
    catalogServiceId: GENERAL_MAINTENANCE,
    scheduledDate: "2026-08-20",
  });
  assert.equal(r.routed, true);
  assert.equal(r.routed === true && r.partnerId, PARTNER_ROUTES[GENERAL_MAINTENANCE]);
});

test("no teto do dia, devolve sem parceiro para alocação manual", async () => {
  const r = await routePartnerForJob(fakeSupabase({ count: PARTNER_DAILY_CAP }), {
    catalogServiceId: EICR,
    scheduledDate: "2026-08-20",
  });
  assert.equal(r.routed, false);
  assert.equal(r.routed === false && r.reason, "cap_reached");
});

test("falha de leitura não vira alocação às cegas", async () => {
  const r = await routePartnerForJob(fakeSupabase({ error: { message: "boom" } }), {
    catalogServiceId: EICR,
    scheduledDate: "2026-08-20",
  });
  assert.equal(r.routed, false);
  assert.equal(r.routed === false && r.reason, "lookup_failed");
});

test("cada família aponta para um parceiro só", () => {
  // Se um dia a rota virar lista, este teste é o que avisa que o resto do
  // código (que assume um id) precisa mudar junto.
  for (const [servico, parceiro] of Object.entries(PARTNER_ROUTES)) {
    assert.equal(typeof parceiro, "string", `${servico} deveria apontar para um id`);
    assert.match(parceiro, /^[0-9a-f-]{36}$/);
  }
});
