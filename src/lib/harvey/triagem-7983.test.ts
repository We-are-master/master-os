import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notaDaAcao } from "@/lib/fila-de-acao";
import type { Decisao } from "./decisoes";
import {
  agendarTriagem7983,
  classePorRegra,
  jobDaMensagem,
  mensagemParaTriagem,
  proximaAcao7983,
  triarMensagemDo7983,
  type Classe7983,
  type JobDaMensagem,
} from "./triagem-7983";

// Número de teste (faixa de ficção da Ofcom), nunca de cliente.
const CONTATO = "447700900123";
const evento = (message: Record<string, unknown>) => ({ EventType: "messages", message: { messageid: "W1", chatid: `${CONTATO}@s.whatsapp.net`, fromMe: false, messageType: "Conversation", ...message } });

/** Supabase de mentira: cada tabela devolve as linhas dadas, e toda consulta fica anotada. */
function fakeSb(linhas: Record<string, unknown[]>, tabelas: string[] = []) {
  const from = (t: string) => {
    tabelas.push(t);
    const b: unknown = new Proxy(
      {},
      {
        get(_, k) {
          if (k === "then") return (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: linhas[t] ?? [], error: null }).then(ok, erro);
          if (k === "maybeSingle") return async () => ({ data: (linhas[t] ?? [])[0] ?? null, error: null });
          return () => b;
        },
      },
    );
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

describe("triagem do 7983: flag desligada não faz nada", () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas = 0;
  beforeEach(() => {
    chamadas = 0;
    globalThis.fetch = (async () => {
      chamadas++;
      throw new Error("rede não devia ser usada");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.HARVEY_TRIAGEM_7983;
  });

  it("sem HARVEY_TRIAGEM_7983: nem banco, nem rede, nem erro", async () => {
    delete process.env.HARVEY_TRIAGEM_7983;
    const tocado: string[] = [];
    const sb = new Proxy({}, { get: (_, k) => { tocado.push(String(k)); throw new Error("banco não devia ser usado"); } }) as SupabaseClient;
    const payload = evento({ text: "Can we move it to Friday instead?" });
    assert.equal(await agendarTriagem7983(sb, payload, "gravada"), false);
    assert.deepEqual(tocado, []);
    assert.equal(chamadas, 0);
  });

  it("só o valor 1 liga: 0, true e vazio continuam desligados", async () => {
    const tocado: string[] = [];
    const sb = new Proxy({}, { get: (_, k) => { tocado.push(String(k)); return undefined; } }) as SupabaseClient;
    for (const v of ["0", "true", "", "on"]) {
      process.env.HARVEY_TRIAGEM_7983 = v;
      assert.equal(await agendarTriagem7983(sb, evento({ text: "nobody came" }), "gravada"), false);
    }
    assert.deepEqual(tocado, []);
    assert.equal(chamadas, 0);
  });

  it("ligada, mas a mensagem não foi gravada (reentrega pulada, recibo, presença): não agenda", async () => {
    process.env.HARVEY_TRIAGEM_7983 = "1";
    const tabelas: string[] = [];
    for (const r of ["enviada pelo OS", "recibo read (1)", "presença online", "erro"]) {
      assert.equal(await agendarTriagem7983(fakeSb({}, tabelas), evento({ text: "nobody came" }), r), false);
    }
    assert.deepEqual(tabelas, []);
  });

  it("ligada, mensagem de parceiro: roda e para no 'não é cliente', sem rede", async () => {
    process.env.HARVEY_TRIAGEM_7983 = "1";
    const tabelas: string[] = [];
    const sb = fakeSb({ partners: [{ id: "p1", whatsapp: "+44 7700 900123", phone: null }] }, tabelas);
    assert.equal(await agendarTriagem7983(sb, evento({ text: "On my way, 10 min" }), "gravada"), true);
    assert.ok(tabelas.includes("partners"));
    assert.ok(!tabelas.includes("jobs"));
    assert.equal(chamadas, 0);
  });
});

describe("mensagemParaTriagem", () => {
  it("só entrada 1 a 1: saída, grupo e reação ficam fora", () => {
    assert.ok(mensagemParaTriagem(evento({ text: "hi" })));
    assert.equal(mensagemParaTriagem(evento({ text: "hi", fromMe: true })), null);
    assert.equal(mensagemParaTriagem(evento({ text: "hi", chatid: "120363401234567890@g.us", isGroup: true })), null);
    assert.equal(mensagemParaTriagem(evento({ text: "👍", messageType: "reaction" })), null);
  });
});

describe("classePorRegra, com mensagens reais de cliente no 7983 (anonimizadas)", () => {
  const casos: Array<[string, Classe7983 | null, string?]> = [
    ["Ok", "confirmacao"],
    ["Okay", "confirmacao"],
    ["Thank you", "confirmacao"],
    ["Ok thanks 👍", "confirmacao"],
    ["Yes that's fine, thank you!", "confirmacao"],
    ["Bom dia", "confirmacao"],
    ["👍", "confirmacao"],
    ["🙄", null],
    ["Hi! Unfortunately, I might not be home between 12pm and 3pm. Would it be possible for the handyman to come after 4:30pm instead?", "remarcacao"],
    ["Can we reschedule to next week?", "remarcacao"],
    ["Hello, please confirm when they will arrive", "horario"],
    ["Hi can you let me know if he will be arriving soon?", "horario"],
    ["What time is he coming tomorrow?", "horario"],
    ["Please cancel the booking, we sorted it ourselves", "cancelamento"],
    ["Hi, Sorry this was already quoted and book in for Friday last week and no one arrived.", "reclamacao"],
    ["Hello - I went to check but there was no one at the door. Please can you confirm the address?", "reclamacao"],
    ["Again delays….", "reclamacao"],
    ["The handyman didn’t turn up today", "reclamacao"],
    ["I won’t be home tomorrow morning, can he come Thursday", "remarcacao"],
    ["I have been waiting outside he said he couldn't find the address", "reclamacao"],
    // A regra não decide: vai ao modelo.
    ["No thank you", null],
    ["Is that ok?", null],
    ["hi he said 7AM as I need to leave my flat by 9:30", null],
    ["Cancel this one and rebook for Friday please", null, "duas classes: ambíguo"],
  ];
  for (const [texto, esperado, nota] of casos) {
    it(`${JSON.stringify(texto)} → ${esperado ?? "modelo"}${nota ? ` (${nota})` : ""}`, () => {
      assert.equal(classePorRegra(texto, "text"), esperado);
    });
  }
  it("mídia sem legenda e áudio sobem como 'outro'; figurinha é nada a fazer", () => {
    assert.equal(classePorRegra("Photo", "image"), "outro");
    assert.equal(classePorRegra("Voice note", "audio"), "outro");
    assert.equal(classePorRegra("Sticker", "sticker"), "confirmacao");
    assert.equal(classePorRegra("nobody came, see photo", "image"), "reclamacao");
  });
});

describe("jobDaMensagem", () => {
  const job = (p: Partial<JobDaMensagem>): JobDaMensagem => ({ id: "j", reference: "JOB-1", status: "scheduled", scheduled_date: "2026-11-11", updated_at: "2026-11-10T08:00:00Z", external_source: "zendesk", external_ref: "51000", ...p });
  it("o job ativo com ticket, pela regra do job-ativo", () => {
    assert.equal(jobDaMensagem([job({ id: "a" }), job({ id: "b", status: "completed" })], "remarcacao", "2026-11-10")?.id, "a");
  });
  it("Finding partner também conta", () => {
    assert.equal(jobDaMensagem([job({ id: "f", status: "auto_assigning" })], "horario", "2026-11-10")?.id, "f");
  });
  it("concluído só para reclamação, e só nos últimos 14 dias", () => {
    const feito = job({ id: "c", status: "completed", scheduled_date: "2026-11-05" });
    assert.equal(jobDaMensagem([feito], "remarcacao", "2026-11-10"), null);
    assert.equal(jobDaMensagem([feito], "reclamacao", "2026-11-10")?.id, "c");
    assert.equal(jobDaMensagem([job({ status: "completed", scheduled_date: "2026-10-01" })], "reclamacao", "2026-11-10"), null);
  });
  it("sem ticket do Zendesk não há onde subir", () => {
    assert.equal(jobDaMensagem([job({ external_source: "housekeep", external_ref: "HK-1" })], "outro", "2026-11-10"), null);
  });
});

describe("proximaAcao7983", () => {
  it("uma linha em inglês com a frase do cliente, dentro do limite da nota", () => {
    const linha = proximaAcao7983("remarcacao", 'Can it be "Friday"\nafter 4pm?');
    assert.equal(linha, `Client asked to reschedule on the 07 WhatsApp: "Can it be 'Friday' after 4pm?". Next: agree a new slot and update the job`);
    const longa = notaDaAcao(proximaAcao7983("outro", "x".repeat(900)));
    assert.ok(longa.length <= 300);
    assert.ok(!longa.includes("\n"));
  });
});

describe("triarMensagemDo7983", () => {
  const cliente = { clients: [{ id: "c1", phone: "07700 900123" }] };
  const jobs = { jobs: [{ id: "j1", reference: "JOB-9001", status: "scheduled", scheduled_date: "2099-01-01", updated_at: "2026-11-10T08:00:00Z", external_source: "zendesk", external_ref: "51999" }] };
  const msg = (texto: string, tipo = "text") => {
    const m = mensagemParaTriagem(evento({ text: texto, messageType: tipo }));
    assert.ok(m);
    return m;
  };
  function deps() {
    const acoes: Array<[number, string]> = [];
    const medidas: Decisao[] = [];
    let modelo = 0;
    return {
      acoes,
      medidas,
      get modelo() { return modelo; },
      d: {
        precisaDeAcao: async (t: number, a: string) => { acoes.push([t, a]); return { ok: true, linha: `#${t} → Action Required` }; },
        registrarMedida: async (_: SupabaseClient, d: Decisao) => { medidas.push(d); },
        classePeloModelo: async () => { modelo++; return "outro" as Classe7983; },
        agora: new Date("2026-11-10T12:00:00Z"),
      },
    };
  }

  it("pedido de remarcação sobe no ticket do job e vira medida no canal whatsapp", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ ...cliente, ...jobs }), msg("Can we reschedule to next week?"), x.d);
    assert.equal(r.classe, "remarcacao");
    assert.deepEqual(x.acoes, [[51999, `Client asked to reschedule on the 07 WhatsApp: "Can we reschedule to next week?". Next: agree a new slot and update the job`]]);
    assert.equal(x.medidas.length, 1);
    assert.equal(x.medidas[0].canal, "whatsapp");
    assert.equal(x.medidas[0].classe, "7983_remarcacao");
    assert.equal(x.medidas[0].acao, "nota_de_triagem");
    assert.equal(x.medidas[0].resultado, "nota");
    assert.equal(x.medidas[0].ticketId, 51999);
    assert.equal(x.medidas[0].referencia, "JOB-9001");
    assert.equal(x.medidas[0].statusEsperado, null);
    assert.ok(x.medidas[0].detalhe?.startsWith("7983 wamid:W1"));
    assert.equal(x.modelo, 0);
  });

  it("ok/obrigado: só a medida, nada no ticket, nem modelo", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ ...cliente, ...jobs }), msg("Ok thanks"), x.d);
    assert.equal(r.feito, "nada a fazer");
    assert.deepEqual(x.acoes, []);
    assert.equal(x.medidas[0].acao, "ignorado");
    assert.equal(x.modelo, 0);
  });

  it("parceiro no 7983 não é triado", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ partners: [{ id: "p1", whatsapp: "447700900123", phone: null }], ...cliente, ...jobs }), msg("nobody came"), x.d);
    assert.equal(r.feito, "não é cliente");
    assert.deepEqual(x.acoes, []);
    assert.deepEqual(x.medidas, []);
  });

  it("número ligado à mão a um parceiro ganha do telefone do cadastro", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ inbox_conversas: [{ vinculo_tipo: "parceiro", vinculo_id: "p1" }], ...cliente, ...jobs }), msg("nobody came"), x.d);
    assert.equal(r.feito, "não é cliente");
  });

  it("reentrega da mesma mensagem não tria de novo", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ harvey_decisoes: [{ id: "d1" }], ...cliente, ...jobs }), msg("nobody came"), x.d);
    assert.equal(r.feito, "já triada");
    assert.deepEqual(x.acoes, []);
    assert.deepEqual(x.medidas, []);
  });

  it("sem job ativo: medida 'faltando', nada no Zendesk", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ ...cliente }), msg("What time is he coming?"), x.d);
    assert.equal(r.feito, "sem job ativo");
    assert.deepEqual(x.acoes, []);
    assert.equal(x.medidas[0].resultado, "faltando");
  });

  it("a regra não sabe: pergunta ao modelo uma vez", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ ...cliente, ...jobs }), msg("hi he said 7AM as I need to leave my flat by 9:30"), x.d);
    assert.equal(x.modelo, 1);
    assert.equal(r.classe, "outro");
    // "outro" fica na /inbox: nada no Zendesk.
    assert.equal(x.acoes.length, 0);
  });

  it("'outro' nunca sobe: fica na /inbox, com a medida registrada", async () => {
    const x = deps();
    const r = await triarMensagemDo7983(fakeSb({ ...cliente, ...jobs }), msg("Photo", "image"), x.d);
    assert.equal(r.feito, "fica na /inbox");
    assert.deepEqual(x.acoes, []);
    assert.equal(x.medidas[0].acao, "ignorado");
  });

  it("falha do Zendesk vira medida 'falhou', sem lançar", async () => {
    const x = deps();
    x.d.precisaDeAcao = async (t: number) => ({ ok: false, linha: `#${t} Action Required falhou: 500` });
    const r = await triarMensagemDo7983(fakeSb({ ...cliente, ...jobs }), msg("Please cancel, we don't need it anymore"), x.d);
    assert.equal(r.classe, "cancelamento");
    assert.equal(x.medidas[0].resultado, "falhou");
  });
});
