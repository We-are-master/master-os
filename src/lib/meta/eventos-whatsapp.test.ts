import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cliqueDaMensagem, idDoEvento, mandarEventoWhatsApp, montarEvento, soDigitos } from "./eventos-whatsapp";

test("clique de anúncio sai do referral da mensagem", () => {
  assert.deepEqual(
    cliqueDaMensagem({ referral: { ctwa_clid: "ARAkLk", source_id: "120252260962430439", source_type: "ad", headline: "Deep clean in London", source_url: "https://fb.me/x" } }),
    { ctwaClid: "ARAkLk", adId: "120252260962430439", headline: "Deep clean in London", sourceUrl: "https://fb.me/x" },
  );
  assert.equal(cliqueDaMensagem({}), null);
  assert.equal(cliqueDaMensagem({ referral: { ctwa_clid: "  " } }), null);
  assert.equal(cliqueDaMensagem(null), null);
});

test("telefone vira só dígitos, como o WhatsApp manda", () => {
  assert.equal(soDigitos("+44 7700 900123"), "447700900123");
  assert.equal(soDigitos(null), "");
});

test("evento no formato da Conversions API de conversas", () => {
  const quando = new Date("2026-09-30T10:00:00Z");
  assert.deepEqual(montarEvento({ evento: "Purchase", eventId: "Purchase-FX-1", ctwaClid: "C1", wabaId: "W1", valor: 237, quando }), {
    event_name: "Purchase",
    event_time: 1790762400,
    event_id: "Purchase-FX-1",
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { whatsapp_business_account_id: "W1", ctwa_clid: "C1" },
    custom_data: { currency: "GBP", value: 237 },
  });
  const lead = montarEvento({ evento: "LeadSubmitted", eventId: "LeadSubmitted-conv", ctwaClid: "C1", wabaId: "W1", valor: 237, quando });
  assert.equal("custom_data" in lead, false, "lead não leva valor");
});

test("compra usa o mesmo event_id do site", () => {
  assert.equal(idDoEvento("Purchase", "FX-ABC"), "Purchase-FX-ABC");
  assert.equal(idDoEvento("LeadSubmitted", "conv1"), "LeadSubmitted-conv1");
});

/** Um Supabase de mentira, só com o que o envio usa. */
function bancoFalso(cliques: Array<{ phone: string; ctwa_clid: string; recebido_em: string }>) {
  const eventos: Array<Record<string, unknown>> = [];
  const sb = {
    from(tabela: string) {
      const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
        gte: (c: string, v: string) => (filtros.push((r) => String(r[c]) >= v), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const linhas = (tabela === "wa_cliques_anuncio" ? cliques : eventos).filter((r) => filtros.every((f) => f(r)));
          return { data: linhas.sort((a, b) => String(b.recebido_em).localeCompare(String(a.recebido_em)))[0] ?? null };
        },
        insert: async (linha: Record<string, unknown>) => {
          if (eventos.some((e) => e.evento === linha.evento && e.event_id === linha.event_id)) return { error: { message: "duplicate" } };
          eventos.push({ ...linha, status: "enviando" });
          return { error: null };
        },
        update: (mud: Record<string, unknown>) => {
          const alvo = { filtros: [] as Array<[string, unknown]> };
          const u = {
            eq: (c: string, v: unknown) => {
              alvo.filtros.push([c, v]);
              if (alvo.filtros.length === 2) for (const e of eventos) if (alvo.filtros.every(([k, val]) => e[k] === val)) Object.assign(e, mud);
              return u;
            },
          };
          return u;
        },
      };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, eventos };
}

const AGORA = new Date("2026-09-30T12:00:00Z");

test("sem clique de anúncio nos últimos 7 dias, nada sai", async () => {
  const { sb } = bancoFalso([{ phone: "447700900123", ctwa_clid: "VELHO", recebido_em: "2026-09-20T12:00:00Z" }]);
  let chamou = false;
  const r = await mandarEventoWhatsApp(sb, { telefone: "+447700900123", evento: "Purchase", chave: "FX-1", valor: 237, agora: AGORA }, (async () => ((chamou = true), new Response("{}"))) as typeof fetch);
  assert.equal(r, "sem clique");
  assert.equal(chamou, false);
});

test("com clique e configuração, manda uma vez e trava a segunda", async () => {
  process.env.META_WA_DATASET_ID = "DS1";
  process.env.META_CAPI_TOKEN = "TOKEN";
  process.env.WHATSAPP_WABA_ID = "W1";
  process.env.META_TEST_EVENT_CODE = "TEST123";
  const { sb, eventos } = bancoFalso([{ phone: "447700900123", ctwa_clid: "CLID9", recebido_em: "2026-09-30T09:00:00Z" }]);
  const chamadas: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  const falsa = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, corpo: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;

  assert.equal(await mandarEventoWhatsApp(sb, { telefone: "+44 7700 900123", evento: "Purchase", chave: "FX-1", valor: 237, agora: AGORA }, falsa), "enviado");
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/DS1\/events\?access_token=TOKEN$/);
  const ev = (chamadas[0].corpo.data as Array<Record<string, unknown>>)[0];
  assert.equal(ev.event_id, "Purchase-FX-1");
  assert.deepEqual(ev.user_data, { whatsapp_business_account_id: "W1", ctwa_clid: "CLID9" });
  assert.equal(chamadas[0].corpo.test_event_code, "TEST123");
  assert.equal(eventos[0].status, "enviado");

  assert.equal(await mandarEventoWhatsApp(sb, { telefone: "447700900123", evento: "Purchase", chave: "FX-1", valor: 237, agora: AGORA }, falsa), "repetido");
  assert.equal(chamadas.length, 1, "não manda a mesma compra duas vezes");
});

test("sem as variáveis, não manda e avisa", async () => {
  delete process.env.META_WA_DATASET_ID;
  const { sb } = bancoFalso([{ phone: "447700900123", ctwa_clid: "CLID9", recebido_em: "2026-09-30T09:00:00Z" }]);
  const r = await mandarEventoWhatsApp(sb, { telefone: "447700900123", evento: "LeadSubmitted", chave: "conv1", agora: AGORA }, (async () => new Response("{}")) as typeof fetch);
  assert.equal(r, "sem configuração");
});
