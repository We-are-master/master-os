/**
 * Harvey parado faz barulho (dono, 23/10/2026). Casos reais: o 401 do Zendesk de
 * 22/10 (12h calado) e o 400 do /api/jobs no #51740.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAUDE_INICIAL,
  depoisDaFalha,
  depoisDoCiclo,
  ehFalhaDeInfra,
  emailDeAlerta,
  emailDeVolta,
  esquecerFalha,
  lerSaude,
  marcarAlertado,
  marcarAnotado,
  marcarVoltou,
  notaDaFalha,
} from "./saude-do-ciclo";

const t = (hm: string) => new Date(`2026-10-22T${hm}:00Z`);
const ERRO_401 = "Error: Zendesk search: HTTP 401";
const ERRO_400 = "Error: OS /api/jobs 400: This service requires a band selection";

describe("o que é falha de infraestrutura", () => {
  it("chave recusada, serviço fora, rede e modelo sem saldo", () => {
    for (const e of [ERRO_401, "Zendesk search: HTTP 403", "HTTP 502 Bad Gateway", "TypeError: fetch failed", "connect ECONNREFUSED", "SemSaldoOpenAI", "Zendesk not configured", "OS /api/jobs 401: Unauthorized", "OS /api/jobs 503: ?"]) {
      assert.equal(ehFalhaDeInfra(new Error(e)), true, e);
    }
  });

  it("erro do ticket não é: 400, 404, 422, dado faltando", () => {
    for (const e of [ERRO_400, "HTTP 422 Unprocessable", "HTTP 404 job not found", "missing client name"]) {
      assert.equal(ehFalhaDeInfra(new Error(e)), false, e);
    }
  });
});

describe("saúde do ciclo: o 401 de 22/10", () => {
  it("um ciclo ruim é soluço: não alerta", () => {
    const r = depoisDoCiclo(SAUDE_INICIAL, ERRO_401, t("21:22"));
    assert.equal(r.acao, "nada");
    assert.equal(r.estado.falhasSeguidas, 1);
    assert.equal(r.estado.falhandoDesde, "2026-10-22T21:22:00.000Z");
  });

  it("o segundo seguido alerta, uma vez só", () => {
    const um = depoisDoCiclo(SAUDE_INICIAL, ERRO_401, t("21:22")).estado;
    const dois = depoisDoCiclo(um, ERRO_401, t("21:27"));
    assert.equal(dois.acao, "alertar");
    const alertado = marcarAlertado(dois.estado, t("21:27"));
    const tres = depoisDoCiclo(alertado, ERRO_401, t("21:32"));
    assert.equal(tres.acao, "nada");
    assert.equal(tres.estado.falhasSeguidas, 3);
    assert.equal(tres.estado.falhandoDesde, "2026-10-22T21:22:00.000Z");
  });

  it("e-mail de alerta que não saiu tenta de novo no ciclo seguinte", () => {
    let e = depoisDoCiclo(SAUDE_INICIAL, ERRO_401, t("21:22")).estado;
    e = depoisDoCiclo(e, ERRO_401, t("21:27")).estado; // alertar, mas o envio falhou
    assert.equal(depoisDoCiclo(e, ERRO_401, t("21:32")).acao, "alertar");
  });

  it("ciclo bom depois do alerta: e-mail de volta, depois zera", () => {
    let e = depoisDoCiclo(SAUDE_INICIAL, ERRO_401, t("21:22")).estado;
    e = marcarAlertado(depoisDoCiclo(e, ERRO_401, t("21:27")).estado, t("21:27"));
    const bom = depoisDoCiclo(e, null, new Date("2026-10-23T09:30:00Z"));
    assert.equal(bom.acao, "voltou");
    assert.equal(bom.estado.falhandoDesde, "2026-10-22T21:22:00.000Z");
    assert.deepEqual(marcarVoltou(), SAUDE_INICIAL);
  });

  it("e-mail de volta que não saiu tenta de novo", () => {
    const e = marcarAlertado({ ...SAUDE_INICIAL, falhasSeguidas: 3, falhandoDesde: "2026-10-22T21:22:00Z", ultimoErro: ERRO_401 });
    const bom = depoisDoCiclo(e, null).estado; // envio falhou
    assert.equal(depoisDoCiclo(bom, null).acao, "voltou");
  });

  it("falha solta sem alerta: o ciclo bom só zera, sem e-mail", () => {
    const um = depoisDoCiclo(SAUDE_INICIAL, ERRO_401, t("21:22")).estado;
    const bom = depoisDoCiclo(um, null, t("21:27"));
    assert.equal(bom.acao, "nada");
    assert.deepEqual(bom.estado, SAUDE_INICIAL);
  });

  it("os e-mails dizem desde quando, quanto tempo e o erro", () => {
    const e = { falhasSeguidas: 2, falhandoDesde: "2026-10-22T21:22:00Z", ultimoErro: ERRO_401, alertadoEm: null };
    const a = emailDeAlerta(e, t("21:27"));
    assert.equal(a.subject, "Harvey stopped working");
    assert.match(a.text, /22 Oct, 22:22/);
    assert.match(a.text, /5 min/);
    assert.match(a.text, /HTTP 401/);
    const v = emailDeVolta(e, new Date("2026-10-23T09:30:00Z"));
    assert.equal(v.subject, "Harvey is working again");
    assert.match(v.text, /12h 8min/);
    for (const txt of [a.text, v.text, a.subject, v.subject]) assert.equal(txt.includes("—"), false);
  });

  it("arquivo de estado com lixo vira estado inicial", () => {
    assert.deepEqual(lerSaude(null), SAUDE_INICIAL);
    assert.deepEqual(lerSaude({ falhasSeguidas: "x", alertadoEm: 5 }), SAUDE_INICIAL);
    assert.equal(lerSaude({ falhasSeguidas: 3 }).falhasSeguidas, 3);
  });
});

describe("falha por ticket: o 400 do #51740", () => {
  it("primeira falha não anota; a segunda igual anota; a terceira igual não repete", () => {
    let r = depoisDaFalha({}, 51740, new Error(ERRO_400));
    assert.equal(r.anotar, false);
    r = depoisDaFalha(r.mapa, 51740, new Error(ERRO_400));
    assert.equal(r.anotar, true);
    const mapa = marcarAnotado(r.mapa, 51740);
    assert.equal(depoisDaFalha(mapa, 51740, new Error(ERRO_400)).anotar, false);
  });

  it("erro diferente depois da nota ganha nota nova (na segunda vez)", () => {
    let r = depoisDaFalha({}, 51740, new Error(ERRO_400));
    r = depoisDaFalha(r.mapa, 51740, new Error(ERRO_400));
    let mapa = marcarAnotado(r.mapa, 51740);
    const outro = "Error: POST /api/jobs: HTTP 422 address is required";
    r = depoisDaFalha(mapa, 51740, new Error(outro));
    assert.equal(r.anotar, false);
    r = depoisDaFalha(r.mapa, 51740, new Error(outro));
    assert.equal(r.anotar, true);
    mapa = r.mapa;
    assert.equal(mapa["51740"]!.falhas, 2);
  });

  it("o mesmo erro com id e hora diferentes é o mesmo erro", () => {
    let r = depoisDaFalha({}, 1, new Error("HTTP 400 job 7e1189e1-37a8-4b8d-a6d3-73956810193c at 2026-10-23T14:12:00Z"));
    r = depoisDaFalha(r.mapa, 1, new Error("HTTP 400 job f31ba2ac-fd22-4961-9081-98e64e4b5c95 at 2026-10-23T14:17:00Z"));
    assert.equal(r.anotar, true);
  });

  it("falha de infraestrutura não conta para o ticket (é do alerta do ciclo)", () => {
    let r = depoisDaFalha({}, 51740, new Error(ERRO_401));
    r = depoisDaFalha(r.mapa, 51740, new Error(ERRO_401));
    assert.equal(r.anotar, false);
    assert.deepEqual(r.mapa, {});
  });

  it("deu certo: sai do mapa", () => {
    const r = depoisDaFalha({}, 51740, new Error(ERRO_400));
    assert.deepEqual(esquecerFalha(r.mapa, 51740), {});
    assert.deepEqual(esquecerFalha({}, 1), {});
  });

  it("a nota diz o que falhou, o erro e o que fazer, em inglês e sem travessão", () => {
    const n = notaDaFalha("booking", 2, ERRO_400);
    assert.match(n, /could not create the job in the OS/);
    assert.match(n, /band selection/);
    assert.equal(n.includes("—"), false);
  });
});
