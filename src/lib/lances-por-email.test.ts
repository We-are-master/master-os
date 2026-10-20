import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classificarMensagem, ehNosso, lerClassificacaoJson, mensagensDaSc, notasDoLancePorEmail, parceiroDoEmail, passoDaMensagem, semCitacao,
} from "./lances-por-email";
import { lerPayloadDoLance } from "./quote-email-cliente";

describe("partner bids by email: reading the side conversation", () => {
  it("never treats our own addresses as a partner", () => {
    assert.equal(ehNosso("team@getfixfy.com"), true);
    assert.equal(ehNosso("support@fixfy.zendesk.com"), true);
    assert.equal(ehNosso("noreply@anything.com"), true);
    assert.equal(ehNosso("whistyle@gmail.com"), false);
  });

  it("matches the partner by main email or a copy email, ignoring case", () => {
    const ps = [
      { id: "p1", email: "WHistyle@Gmail.com", job_cc_emails: [] },
      { id: "p2", email: "boss@acme.co.uk", job_cc_emails: ["office@acme.co.uk"] },
    ];
    assert.equal(parceiroDoEmail("whistyle@gmail.com", ps)?.id, "p1");
    assert.equal(parceiroDoEmail("OFFICE@acme.co.uk", ps)?.id, "p2");
    assert.equal(parceiroDoEmail("someone@else.com", ps), null);
    assert.equal(parceiroDoEmail("team@getfixfy.com", [{ id: "x", email: "team@getfixfy.com" }]), null);
  });

  it("cuts the quoted previous email", () => {
    const t = "Hi, I can do it for £450 all in.\nThanks\n\nOn Tue, 14 Oct 2026 at 10:02, Fixfy Team <team@getfixfy.com> wrote:\n> Hi, could you price QT-2026-1180?";
    assert.equal(semCitacao(t), "Hi, I can do it for £450 all in.\nThanks");
    assert.equal(semCitacao("Price is 300\n-----Original Message-----\nFrom: x"), "Price is 300");
    assert.equal(semCitacao("> only quote"), "");
  });

  it("turns events into messages with a stable id, oldest first, skipping empty ones", () => {
    const ms = mensagensDaSc("sc1", [
      { id: 2, created_at: "2026-10-15T10:00:00Z", message: { body: "£300", from: { email: "A@x.com" } } },
      { id: 1, created_at: "2026-10-14T10:00:00Z", message: { body: "Please price this", from: { email: "team@getfixfy.com" } } },
      { id: 3, created_at: "2026-10-15T11:00:00Z", message: { body: "> quoted only", from: { email: "a@x.com" } } },
      { created_at: "2026-10-15T12:00:00Z", message: { body: "no id" } },
    ]);
    assert.deepEqual(ms.map((m) => m.id), ["sc:sc1:1", "sc:sc1:2"]);
    assert.equal(ms[1]!.deEmail, "a@x.com");
  });
});

describe("partner bids by email: classification", () => {
  it("reads a bid and makes labour + materials add up to the total", () => {
    const c = lerClassificacaoJson('{"type":"bid","total":"£1,200","labour":900,"materials":250,"duration":"2 days","notes":"Strip and refit — the worktop","answer":null}');
    assert.equal(c?.tipo, "bid");
    assert.equal(c?.total, 1200);
    assert.equal(c?.materials, 250);
    assert.equal(c?.labour, 950);
    assert.equal(c?.duracao, "2 days");
    assert.equal(c?.notas, "Strip and refit, the worktop");
  });

  it("builds the total from labour when the total is missing", () => {
    const c = lerClassificacaoJson('{"type":"bid","total":null,"labour":300,"materials":50}');
    assert.equal(c?.total, 350);
    assert.equal(c?.labour, 300);
  });

  it("a partner question goes to the customer (B3)", () => {
    const c = lerClassificacaoJson('{"type":"question","total":null,"question":"Is there parking outside the property?"}');
    assert.equal(c?.tipo, "question");
    assert.equal(c?.pergunta, "Is there parking outside the property?");
    assert.equal(passoDaMensagem(c!), "pergunta_ao_cliente");
    // Sem a pergunta reescrita não há o que mandar.
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"question","total":null,"question":null}')!), "nada");
  });

  it("a bid without a number is not a bid", () => {
    assert.equal(lerClassificacaoJson('{"type":"bid","total":null}')?.tipo, "other");
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"bid","total":0}')!), "nada");
  });

  it("materials bigger than the total are dropped", () => {
    const c = lerClassificacaoJson('{"type":"revised_bid","total":200,"materials":500}');
    assert.equal(c?.materials, null);
    assert.equal(c?.labour, 200);
  });

  it("rejects broken or unknown answers", () => {
    assert.equal(lerClassificacaoJson("not json"), null);
    assert.equal(lerClassificacaoJson('{"type":"maybe"}'), null);
    assert.equal(lerClassificacaoJson("[1,2]"), null);
  });

  it("decides what to do", () => {
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"bid","total":100}')!), "gravar_lance");
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"revised_bid","total":120}')!), "gravar_lance");
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"answer","answer":"Yes, solid oak"}')!), "nota_resposta");
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"answer","total":500,"answer":"Oak is extra"}')!), "gravar_lance");
    assert.equal(passoDaMensagem(lerClassificacaoJson('{"type":"other"}')!), "nada");
  });

  it("calls the model with the quote, our last message and their reply", async () => {
    let visto = "";
    const c = await classificarMensagem(
      { referencia: "QT-2026-1180", escopo: "Fit a kitchen worktop", nossaUltima: "Could you price it?", texto: "450 all in" },
      async (_s, u) => {
        visto = u;
        return '{"type":"bid","total":450}';
      },
    );
    assert.equal(c?.total, 450);
    assert.match(visto, /QT-2026-1180/);
    assert.match(visto, /Could you price it\?/);
    assert.match(visto, /450 all in/);
  });
});

describe("partner bids by email: bid notes", () => {
  it("are in the portal format, so the draft reads labour and materials", () => {
    const c = lerClassificacaoJson('{"type":"bid","total":1200,"materials":250,"notes":"Fit a solid oak worktop"}')!;
    const notas = notasDoLancePorEmail(c, { quando: "2026-10-15 10:00", textoDoParceiro: "1200 all in, 250 of it materials" });
    const p = lerPayloadDoLance(notas);
    assert.equal(p.labourCost, 950);
    assert.equal(p.materialsCost, 250);
    assert.equal(p.labourDescription, "Fit a solid oak worktop");
    assert.match(notas, /Sent by email in the Zendesk side conversation/);
  });
});
