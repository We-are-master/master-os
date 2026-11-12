import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTOR,
  MARCA,
  MARCA_ATUALIZACAO,
  MARCA_PEDIDO,
  MARCA_PEDIDO_NAO_ENVIADO,
  FIM_DO_RASCUNHO,
  TAG_ENVIAR,
  enviarAprovados,
  ligarMensagensAoJob,
  pedidoAoParceiro,
  rascunhoAprovavel,
  type ParceiroDoJohn,
  conferirRascunho,
  corpoDoJournal,
  etapaDoRascunho,
  fatosDoJob,
  johnLigado,
  notaDoTicket,
  notaJaNoTicket,
  numerosNovos,
  passoDoJohn,
  polirComLLM,
  putDaNota,
  rascunhoParaCliente,
  rascunhoParaParceiro,
  rodarJohn,
  type JobDaReclamacao,
  type LinhaDoJournal,
  type ZendeskDoJohn,
} from "./rascunho-reclamacao";

const AGORA = new Date("2026-11-10T12:00:00Z");

const JOB: JobDaReclamacao = {
  id: "j1",
  reference: "JOB-9700",
  title: "End of tenancy clean",
  status: "on_hold",
  client_name: "jane doe",
  partner_id: "p1",
  partner_name: "F&V Cleaning",
  scheduled_date: "2026-11-04",
  external_source: "zendesk",
  external_ref: "51000",
  on_hold_at: "2026-11-09T09:00:00Z",
  on_hold_reason: "Complaint — Oven not cleaned (raised in ticket #51001)",
  on_hold_reason_preset_id: "complaint",
  on_hold_complaint_description: "Oven not cleaned, I want a refund (raised in ticket #51001)",
  on_hold_submission: null,
  on_hold_submission_at: null,
};
const CONTATO = { contact_name: "Sam Vale", company_name: "F&V Cleaning" };

const rascunho = (etapa: "inicial" | "depois-da-resposta", em: string): LinhaDoJournal => ({
  job_id: "j1",
  author: "office",
  body: `${etapa === "inicial" ? MARCA : MARCA_ATUALIZACAO}\n\nTo the partner:\nHi`,
  photos: [],
  created_at: em,
});
/** O pedido de evidência que saiu no 7983 (com o wamid que liga a resposta ao job). */
const pedido = (em: string, wamid = "W1"): LinhaDoJournal => ({ job_id: "j1", author: "office", body: `${MARCA_PEDIDO} [wamid:${wamid}]\nHi Sam`, photos: [], created_at: em });
const PEDIDO_ONTEM = pedido("2026-11-09T09:05:00Z");
const doParceiro = (em: string, fotos: string[] = []): LinhaDoJournal => ({ job_id: "j1", author: "partner", body: "I can go back", photos: fotos, created_at: em });

/** Supabase falso: devolve as tabelas e guarda os inserts. */
function sbFalso(tabelas: Record<string, unknown[]>) {
  const inserts: Array<{ tabela: string; linha: Record<string, unknown> }> = [];
  const sb = {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gte", "in", "limit", "order"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabelas[tabela] ?? [], error: null }).then(ok);
      q.maybeSingle = async () => ({ data: (tabelas[tabela] ?? [])[0] ?? null, error: null });
      q.insert = async (linha: Record<string, unknown>) => {
        inserts.push({ tabela, linha });
        return { error: null };
      };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, inserts };
}

function zendeskFalso(opts: { status?: string; comentarios?: Array<{ public: boolean; body: string; created_at: string }> } = {}) {
  const notas: Array<{ id: number; corpo: string }> = [];
  const zd: ZendeskDoJohn = {
    lerTicket: async () => ({ status: opts.status ?? "open", support_type: "agent" }),
    lerComentarios: async () => opts.comentarios ?? [],
    postarNota: async (id, corpo) => {
      notas.push({ id, corpo });
    },
  };
  return { zd, notas };
}

describe("flag JOHN_RASCUNHO", () => {
  it("só liga com 1", () => {
    assert.equal(johnLigado({}), false);
    assert.equal(johnLigado({ JOHN_RASCUNHO: "0" }), false);
    assert.equal(johnLigado({ JOHN_RASCUNHO: "true" }), false);
    assert.equal(johnLigado({ JOHN_RASCUNHO: " 1 " }), true);
  });

  it("desligada, a passada não lê nem escreve nada (nem banco, nem Zendesk, nem modelo)", async () => {
    const explode = new Proxy({}, { get: () => { throw new Error("tocou no banco com a flag desligada"); } }) as SupabaseClient;
    const zd: ZendeskDoJohn = {
      lerTicket: async () => { throw new Error("Zendesk"); },
      lerComentarios: async () => { throw new Error("Zendesk"); },
      postarNota: async () => { throw new Error("Zendesk"); },
    };
    const r = await rodarJohn(explode, { aplicar: true, env: {}, zendesk: zd, llm: async () => { throw new Error("modelo"); } });
    assert.deepEqual(r, { desligado: true, linhas: [], escritos: 0 });
  });
});

describe("passoDoJohn", () => {
  it("hold novo → primeiro o pedido ao parceiro; o caso só depois de 24h sem resposta", () => {
    assert.equal(passoDoJohn(JOB, [], AGORA), "pedido");
    assert.equal(passoDoJohn(JOB, [pedido("2026-11-10T08:00:00Z")], AGORA), "nada");
    assert.equal(passoDoJohn(JOB, [PEDIDO_ONTEM], AGORA), "inicial");
    assert.equal(passoDoJohn(JOB, [PEDIDO_ONTEM, rascunho("inicial", "2026-11-10T09:10:00Z")], AGORA), "nada");
  });

  it("pedido que não saiu → o caso vai à equipe sem esperar; sem parceiro → caso direto", () => {
    const naoSaiu: LinhaDoJournal = { job_id: "j1", author: "office", body: `${MARCA_PEDIDO_NAO_ENVIADO} no mobile`, photos: [], created_at: "2026-11-10T11:00:00Z" };
    assert.equal(passoDoJohn(JOB, [naoSaiu], AGORA), "inicial");
    assert.equal(passoDoJohn({ ...JOB, partner_id: null }, [], AGORA), "inicial");
  });

  it("parceiro respondeu ao pedido antes das 24h → caso com a resposta", () => {
    assert.equal(passoDoJohn(JOB, [pedido("2026-11-10T08:00:00Z"), doParceiro("2026-11-10T10:00:00Z")], AGORA), "depois-da-resposta");
  });

  it("não é reclamação, não está em hold ou o hold é antigo → nada", () => {
    assert.equal(passoDoJohn({ ...JOB, on_hold_reason_preset_id: "access_issue", on_hold_reason: "Access issue", on_hold_complaint_description: null }, [], AGORA), "nada");
    assert.equal(passoDoJohn({ ...JOB, status: "in_progress_phase1" }, [], AGORA), "nada");
    assert.equal(passoDoJohn({ ...JOB, on_hold_at: "2026-10-01T09:00:00Z" }, [], AGORA), "nada");
    assert.equal(passoDoJohn({ ...JOB, on_hold_at: null }, [], AGORA), "nada");
  });

  it("rascunho de um hold anterior não conta", () => {
    assert.equal(passoDoJohn(JOB, [rascunho("depois-da-resposta", "2026-11-01T09:00:00Z")], AGORA), "pedido");
  });

  it("parceiro respondeu depois do rascunho → atualiza uma vez só", () => {
    const linhas = [rascunho("inicial", "2026-11-09T09:10:00Z"), doParceiro("2026-11-09T15:00:00Z")];
    assert.equal(passoDoJohn(JOB, linhas, AGORA), "depois-da-resposta");
    assert.equal(passoDoJohn(JOB, [...linhas, rascunho("depois-da-resposta", "2026-11-09T15:10:00Z")], AGORA), "nada");
    // Outra resposta depois da atualização: não escreve de novo.
    assert.equal(passoDoJohn(JOB, [...linhas, rascunho("depois-da-resposta", "2026-11-09T15:10:00Z"), doParceiro("2026-11-10T08:00:00Z")], AGORA), "nada");
  });

  it("resposta pelo formulário de on hold também conta; resposta de hold anterior não", () => {
    const comSub = { ...JOB, on_hold_submission: { notes: "Will go back", photos: ["a.jpg"] }, on_hold_submission_at: "2026-11-09T14:00:00Z" };
    assert.equal(passoDoJohn(comSub, [rascunho("inicial", "2026-11-09T09:10:00Z")], AGORA), "depois-da-resposta");
    assert.equal(passoDoJohn({ ...comSub, on_hold_submission_at: "2026-10-01T10:00:00Z" }, [rascunho("inicial", "2026-11-09T09:10:00Z")], AGORA), "nada");
    // Já respondeu antes do primeiro rascunho: o primeiro já sai como atualização, e é o único.
    assert.equal(passoDoJohn(comSub, [], AGORA), "depois-da-resposta");
  });
});

describe("os rascunhos", () => {
  it("inicial: curto, factual, pede fotos e a volta, sem dinheiro nem culpa", () => {
    const f = fatosDoJob(JOB, [], CONTATO, AGORA);
    const p = rascunhoParaParceiro(f, "inicial");
    const c = rascunhoParaCliente(f, "inicial");
    assert.match(p, /^Hi Sam,/);
    assert.match(p, /JOB-9700 \(End of tenancy clean, Wed 4 Nov\): "Oven not cleaned, I want a refund"/);
    assert.match(p, /photos/);
    assert.match(c, /^Hi Jane,/);
    assert.match(c, /checking this with the professional/);
    assert.match(c, /photos/);
    assert.doesNotMatch(c, /F&V|Sam|refund|discount|£/i);
    assert.doesNotMatch(c + p, /—/);
    // A queixa citada ao parceiro tem "refund", mas a fala é do cliente.
    assert.equal(conferirRascunho(p, { publico: "parceiro", citacoes: [f.reclamacao] }).ok, true);
    assert.equal(conferirRascunho(c, { publico: "cliente", nomesDoParceiro: f.nomesDoParceiro }).ok, true);
  });

  it("depois da resposta: as voltas oferecidas vão ao cliente; desconto do parceiro nunca", () => {
    const comVolta = {
      ...JOB,
      on_hold_submission: { notes: "ok", photos: [], remedy: "revisit" as const, offers: [{ data: "2026-11-12", slot: "morning" as const }, { data: "2026-11-01", slot: "afternoon" as const }] },
      on_hold_submission_at: "2026-11-09T14:00:00Z",
    };
    const f = fatosDoJob(comVolta, [], CONTATO, AGORA);
    const c = rascunhoParaCliente(f, "depois-da-resposta");
    assert.match(c, /Thu 12 Nov, morning \(8am to 1pm\)\. Would one of these work/);
    assert.doesNotMatch(c, /1 Nov/); // a que já passou sai
    assert.match(rascunhoParaParceiro(f, "depois-da-resposta"), /send a few photos/); // sem fotos, pede

    const comDesconto = { ...comVolta, on_hold_submission: { notes: "ok", photos: ["x.jpg"], remedy: "discount" as const, discount_gbp: 40 } };
    const fd = fatosDoJob(comDesconto, [], CONTATO, AGORA);
    for (const t of [rascunhoParaCliente(fd, "depois-da-resposta"), rascunhoParaParceiro(fd, "depois-da-resposta")]) {
      assert.doesNotMatch(t, /discount|£|40/i);
      assert.equal(conferirRascunho(t, { publico: "cliente", nomesDoParceiro: fd.nomesDoParceiro }).ok, true);
    }
  });

  it("a conferência barra dinheiro, culpa, promessa e o nome do parceiro ao cliente", () => {
    const barra = (t: string) => conferirRascunho(t, { publico: "cliente", nomesDoParceiro: ["F&V Cleaning"] }).ok;
    assert.equal(barra("Hi Jane, we will refund you."), false);
    assert.equal(barra("Hi Jane, we can offer a 10% discount."), false);
    assert.equal(barra("Hi Jane, sorry, that was our fault."), false);
    assert.equal(barra("Hi Jane, we'll fix it free of charge."), false);
    assert.equal(barra("Hi Jane, F&V Cleaning will come back."), false);
    assert.equal(barra("Hi Jane, we're checking with the professional."), true);
  });

  it("modelo: aceita só o que passa; número novo ou dinheiro volta ao modelo pronto", async () => {
    const f = fatosDoJob(JOB, [], CONTATO, AGORA);
    const base = { parceiro: rascunhoParaParceiro(f, "inicial"), cliente: rascunhoParaCliente(f, "inicial") };
    const bom = await polirComLLM(base, f, async () => JSON.stringify({ partner: "Hi Sam, quick one on JOB-9700: the customer says the oven wasn't cleaned. Could you send photos? Thanks,\nFixfy Team", customer: "Hi Jane, thanks for telling us about job JOB-9700. We're checking with the professional. Thanks,\nFixfy Team" }));
    assert.deepEqual(bom.usouLLM, { parceiro: true, cliente: true });
    const ruim = await polirComLLM(base, f, async () => JSON.stringify({ partner: "Hi Sam, please go back on 14 Nov at 9am. Thanks,\nFixfy Team", customer: "Hi Jane, we'll give you a refund for job JOB-9700. Thanks,\nFixfy Team" }));
    assert.deepEqual(ruim.usouLLM, { parceiro: false, cliente: false });
    assert.equal(ruim.cliente, base.cliente);
    const quebrado = await polirComLLM(base, f, async () => "não é json");
    assert.equal(quebrado.parceiro, base.parceiro);
    assert.deepEqual(numerosNovos("on 14 Nov, JOB-9700", "JOB-9700"), ["14"]);
  });
});

describe("Zendesk: só nota interna", () => {
  it("o PUT é sempre comentário interno e liga o Action Required", () => {
    const put = putDaNota(notaDoTicket("inicial", "Hi Jane"));
    assert.equal(put.ticket.comment.public, false);
    assert.match(put.ticket.comment.body, /^⚡ Action Required: Complaint case ready/);
    assert.match(put.ticket.comment.body, /\[Draft by John, not sent\]\nHi Jane\n\[End of draft\]/);
    assert.equal(etapaDoRascunho(put.ticket.comment.body), "inicial");
    assert.equal(etapaDoRascunho(notaDoTicket("depois-da-resposta", "x")), "depois-da-resposta");
  });

  it("nota da mesma etapa já no ticket (interna, deste hold) não é postada de novo", () => {
    const nota = { public: false, body: notaDoTicket("inicial", "Hi"), created_at: "2026-11-09T09:05:00Z" };
    assert.equal(notaJaNoTicket([nota], "inicial", JOB.on_hold_at), true);
    assert.equal(notaJaNoTicket([nota], "depois-da-resposta", JOB.on_hold_at), false);
    assert.equal(notaJaNoTicket([{ ...nota, public: true }], "inicial", JOB.on_hold_at), false);
    assert.equal(notaJaNoTicket([{ ...nota, created_at: "2026-11-01T00:00:00Z" }], "inicial", JOB.on_hold_at), false);
  });
});

describe("rodarJohn com a flag ligada", () => {
  const env = { JOHN_RASCUNHO: "1" };

  it("grava o rascunho no journal com visible_to_partner=false e a nota interna no ticket", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [PEDIDO_ONTEM], partners: [{ id: "p1", ...CONTATO }] });
    const { zd, notas } = zendeskFalso();
    const r = await rodarJohn(sb, { aplicar: true, env, agora: AGORA, zendesk: zd });
    assert.equal(r.escritos, 1);
    assert.equal(inserts.length, 1);
    const l = inserts[0]!.linha;
    assert.equal(inserts[0]!.tabela, "job_complaint_messages");
    assert.equal(l.visible_to_partner, false);
    assert.equal(l.author, "office");
    assert.equal(l.author_name, AUTOR);
    assert.ok(String(l.body).startsWith(MARCA));
    assert.match(String(l.body), /To the partner:\nHi Sam/);
    assert.match(String(l.body), /internal note on ticket #51000/);
    assert.equal(notas.length, 1);
    assert.equal(notas[0]!.id, 51000);
    assert.match(notas[0]!.corpo, /Hi Jane/);
  });

  it("ensaio não escreve nada", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [PEDIDO_ONTEM], partners: [] });
    const { zd, notas } = zendeskFalso();
    const r = await rodarJohn(sb, { aplicar: false, env, agora: AGORA, zendesk: zd });
    assert.equal(inserts.length + notas.length + r.escritos, 0);
    assert.match(r.linhas.join("\n"), /JOB-9700: caso inicial \(ensaio/);
  });

  it("já rascunhado: não escreve de novo", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [PEDIDO_ONTEM, rascunho("inicial", "2026-11-09T09:10:00Z")] });
    const { zd, notas } = zendeskFalso();
    await rodarJohn(sb, { aplicar: true, env, agora: AGORA, zendesk: zd });
    assert.equal(inserts.length + notas.length, 0);
  });

  it("ticket resolvido: não toca no ticket, o rascunho ao cliente fica no journal", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [PEDIDO_ONTEM] });
    const { zd, notas } = zendeskFalso({ status: "solved" });
    await rodarJohn(sb, { aplicar: true, env, agora: AGORA, zendesk: zd });
    assert.equal(notas.length, 0);
    assert.match(String(inserts[0]!.linha.body), /To the customer \(not on ticket #51000: ticket is solved\):\nHi Jane/);
    assert.equal(inserts[0]!.linha.visible_to_partner, false);
  });

  it("a nota já estava no ticket (passada anterior caiu antes do journal): grava só o journal", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [PEDIDO_ONTEM] });
    const { zd, notas } = zendeskFalso({ comentarios: [{ public: false, body: notaDoTicket("inicial", "Hi"), created_at: "2026-11-09T09:05:00Z" }] });
    await rodarJohn(sb, { aplicar: true, env, agora: AGORA, zendesk: zd });
    assert.equal(notas.length, 0);
    assert.equal(inserts.length, 1);
  });

  it("sem ticket e sem parceiro: os dois avisos no journal", () => {
    const corpo = corpoDoJournal("inicial", { parceiro: null, cliente: "Hi Jane", ticket: null });
    assert.match(corpo, /No partner on this job/);
    assert.match(corpo, /To the customer \(this job has no Zendesk ticket\):\nHi Jane/);
  });
});

describe("pedido de evidência ao parceiro (7983)", () => {
  const parceiroFalso = () => {
    const enviados: Array<{ tel: string; texto: string }> = [];
    const p: ParceiroDoJohn = {
      enviar: async (tel, texto) => {
        enviados.push({ tel, texto });
        return { wamid: "WX9" };
      },
      linkDoFormulario: async () => "https://os.example/r/abc",
    };
    return { p, enviados };
  };
  const PARCEIRO = { id: "p1", ...CONTATO, phone: "07700 900123", whatsapp: null };

  it("o texto leva o número do job, a queixa, as 3 perguntas e o link; sem dinheiro", () => {
    const f = fatosDoJob(JOB, [], CONTATO, AGORA);
    const t = pedidoAoParceiro(f, "https://os.example/r/abc");
    assert.match(t, /JOB-9700/);
    assert.match(t, /Oven not cleaned/);
    assert.match(t, /1\. what you did[^]*\n2\. photos[^]*\n3\. when you could go back/);
    assert.match(t, /https:\/\/os\.example\/r\/abc/);
    assert.ok(conferirRascunho(t, { publico: "parceiro", citacoes: [f.reclamacao] }).ok);
  });

  it("com JOHN_AVISA_PARCEIRO=1: manda no 7983 e grava no journal visível ao parceiro, com o wamid", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [], partners: [PARCEIRO] });
    const { p, enviados } = parceiroFalso();
    const { zd, notas } = zendeskFalso();
    await rodarJohn(sb, { aplicar: true, env: { JOHN_RASCUNHO: "1", JOHN_AVISA_PARCEIRO: "1" }, agora: AGORA, zendesk: zd, parceiro: p });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0]!.tel, "+447700900123");
    assert.equal(notas.length, 0, "o caso ao cliente espera o parceiro");
    assert.equal(inserts[0]!.linha.visible_to_partner, true);
    assert.match(String(inserts[0]!.linha.body), /^\[John asked the partner for evidence on WhatsApp\] \[wamid:WX9\]/);
  });

  it("chave desligada: nada sai; o journal diz por quê, e o caso vai à equipe na passada seguinte", async () => {
    const { sb, inserts } = sbFalso({ jobs: [JOB], job_complaint_messages: [], partners: [PARCEIRO] });
    const { p, enviados } = parceiroFalso();
    await rodarJohn(sb, { aplicar: true, env: { JOHN_RASCUNHO: "1" }, agora: AGORA, zendesk: zendeskFalso().zd, parceiro: p });
    assert.equal(enviados.length, 0);
    assert.equal(inserts[0]!.linha.visible_to_partner, false);
    assert.match(String(inserts[0]!.linha.body), /^\[John could not ask the partner on WhatsApp\] JOHN_AVISA_PARCEIRO is off/);
    assert.equal(passoDoJohn(JOB, [{ ...(inserts[0]!.linha as unknown as LinhaDoJournal), created_at: AGORA.toISOString() }], AGORA), "inicial");
  });
});

describe("mensagem do parceiro no 7983 → o job certo", () => {
  const J2: JobDaReclamacao = { ...JOB, id: "j2", reference: "JOB-9701" };
  const msg = (wamid: string, quoted = "") => ({ wamid, partner_id: "p1", tipo: "image", texto: null, criado_em: "2026-11-09T12:00:00Z", bruto: { quoted } });

  it("um job só em reclamação: só liga se citar o pedido ou disser o número; o resto só é contado", () => {
    assert.equal(ligarMensagensAoJob([msg("M1", "447983182332:W1")], [JOB], [PEDIDO_ONTEM]).ligadas[0]!.job.reference, "JOB-9700");
    assert.equal(ligarMensagensAoJob([{ ...msg("M3"), tipo: "text", texto: "about job 9700, I left at 5pm" }], [JOB], [PEDIDO_ONTEM]).ligadas.length, 1);
    const agenda = ligarMensagensAoJob([{ ...msg("M4"), tipo: "text", texto: "send me tomorrow's jobs" }], [JOB], [PEDIDO_ONTEM]);
    assert.equal(agenda.ligadas.length, 0);
    assert.equal(agenda.depoisDoPedido.get("j1"), 1);
  });

  it("dois jobs: citou o pedido → o job do pedido; não citou → nenhum (fica para a equipe)", () => {
    const linhas = [PEDIDO_ONTEM, { ...pedido("2026-11-09T09:06:00Z", "W2"), job_id: "j2" }];
    assert.equal(ligarMensagensAoJob([msg("M1", "447983182332:W2")], [JOB, J2], linhas).ligadas[0]!.job.reference, "JOB-9701");
    const semCitar = ligarMensagensAoJob([msg("M2")], [JOB, J2], linhas);
    assert.equal(semCitar.ligadas.length, 0);
    assert.equal(semCitar.semJob.length, 1);
  });

  it("mensagem já no journal não entra de novo", () => {
    const ja: LinhaDoJournal = { job_id: "j1", author: "partner", body: "[WhatsApp M1] (image sent on WhatsApp, see /inbox)", photos: [], created_at: "2026-11-09T12:00:00Z" };
    assert.equal(ligarMensagensAoJob([msg("M1", "x:W1")], [JOB], [PEDIDO_ONTEM, ja]).ligadas.length, 0);
  });

  it("foto do 7983 conta como evidência e faz o caso sair com a resposta", () => {
    const foto: LinhaDoJournal = { job_id: "j1", author: "partner", body: "[WhatsApp M1] (image sent on WhatsApp, see /inbox)", photos: [], created_at: "2026-11-09T12:00:00Z" };
    assert.equal(passoDoJohn(JOB, [PEDIDO_ONTEM, foto], AGORA), "depois-da-resposta");
    assert.equal(fatosDoJob(JOB, [foto], CONTATO, AGORA).resposta?.fotos, 1);
  });
});

describe("macro John: send reply", () => {
  const nota = (texto: string, em: string) => ({ public: false, body: notaDoTicket("inicial", texto, "Complaint on JOB-9700: x"), created_at: em });

  it("pega o rascunho mais recente, sem marca, sem caso e sem a linha de fim", () => {
    const t = rascunhoAprovavel([nota("Hi Jane, older draft here.", "2026-11-09T10:00:00Z"), nota("Hi Jane, newest draft here.", "2026-11-10T10:00:00Z")]);
    assert.equal(t, "Hi Jane, newest draft here.");
    assert.ok(!t!.includes(FIM_DO_RASCUNHO));
  });

  it("envia público e grava no journal; sem rascunho, nada sai", async () => {
    const enviados: Array<{ id: number; texto: string }> = [];
    const zd: ZendeskDoJohn = {
      lerTicket: async () => null,
      lerComentarios: async (id) => (id === 51000 ? [nota("Hi Jane, we're looking into it with the professional.", "2026-11-10T10:00:00Z")] : []),
      postarNota: async () => {},
      ticketsComTag: async (tag) => (tag === TAG_ENVIAR ? [51000, 52000] : []),
      responderCliente: async (id, texto) => {
        enviados.push({ id, texto });
      },
    };
    const { sb, inserts } = sbFalso({ jobs: [] });
    const r = await enviarAprovados(sb, zd, true);
    assert.deepEqual(enviados, [{ id: 51000, texto: "Hi Jane, we're looking into it with the professional." }]);
    assert.match(r.linhas.join("\n"), /#52000: macro aplicada mas sem rascunho/);
    assert.equal(inserts.length, 0, "sem job ligado ao ticket no banco falso");
  });

  it("rascunho que alguém editou com dinheiro não sai", async () => {
    const enviados: unknown[] = [];
    const zd: ZendeskDoJohn = {
      lerTicket: async () => null,
      lerComentarios: async () => [nota("Hi Jane, we will refund you in full today.", "2026-11-10T10:00:00Z")],
      postarNota: async () => {},
      ticketsComTag: async () => [51000],
      responderCliente: async (...a) => {
        enviados.push(a);
      },
    };
    const r = await enviarAprovados(sbFalso({}).sb, zd, true);
    assert.equal(enviados.length, 0);
    assert.match(r.linhas.join("\n"), /barrado/);
  });
});
