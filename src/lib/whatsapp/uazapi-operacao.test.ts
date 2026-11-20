import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extrairEdicaoUazapi, extrairMensagemUazapi } from "./uazapi-operacao";

const evento = (message: Record<string, unknown>) => ({ EventType: "messages", message });

/** O `toMatchObject` do vitest (que não está no repo, 10/11/2026): só os campos dados, também por dentro. */
function contem(real: unknown, parcial: Record<string, unknown>): void {
  const r = (real ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(parcial)) {
    if (v && typeof v === "object" && !Array.isArray(v)) contem(r[k], v as Record<string, unknown>);
    else assert.deepEqual(r[k], v, k);
  }
}

describe("extrairMensagemUazapi", () => {
  it("mensagem do parceiro vira entrada com nome e hora em ms", () => {
    const m = extrairMensagemUazapi(
      evento({ messageid: "ABC", chatid: "447700900123@s.whatsapp.net", fromMe: false, text: "On my way", senderName: "Dan", messageTimestamp: 1762130000000, messageType: "Conversation" }),
    );
    contem(m, { wamid: "ABC", contato: "447700900123", direcao: "entrada", tipo: "text", texto: "On my way", contatoNome: "Dan" });
    assert.equal("criadoEm" in m && m.criadoEm, new Date(1762130000000).toISOString());
  });

  it("o que saiu pelo celular entra como saída, sem nome do contato", () => {
    const m = extrairMensagemUazapi(evento({ messageid: "X1", chatid: "447700900123@s.whatsapp.net", fromMe: true, text: "ok" }));
    contem(m, { direcao: "saida", contatoNome: null });
  });

  it("pula o que o OS mandou, grupo antigo, broadcast e evento que não é mensagem", () => {
    assert.deepEqual(extrairMensagemUazapi(evento({ messageid: "X2", chatid: "447700900123@s.whatsapp.net", fromMe: true, wasSentByApi: true, text: "hi" })), { pular: "enviada pelo OS" });
    assert.deepEqual(extrairMensagemUazapi(evento({ messageid: "X3", chatid: "447700900123-1600000000@g.us", isGroup: true, text: "hi" })), { pular: "grupo antigo" });
    assert.deepEqual(extrairMensagemUazapi(evento({ messageid: "X5", chatid: "status@broadcast", text: "hi" })), { pular: "broadcast" });
    assert.deepEqual(extrairMensagemUazapi({ EventType: "connection" }), { pular: "evento connection" });
  });

  it("grupo entra pelo id do grupo, com quem mandou e o assunto", () => {
    const m = extrairMensagemUazapi(
      evento({ messageid: "G1", chatid: "120363401234567890@g.us", isGroup: true, sender: "123@lid", sender_pn: "447700900123@s.whatsapp.net", senderName: "Dan", groupName: "Kings Cross job", text: "Done" }),
    );
    contem(m, { contato: "120363401234567890", contatoNome: null, direcao: "entrada", grupo: { autor: "447700900123", autorNome: "Dan", nome: "Kings Cross job" } });
  });

  it("número escondido (LID) fica sem autor, mas com o nome", () => {
    const m = extrairMensagemUazapi(evento({ messageid: "G2", chatid: "120363401234567890@g.us", isGroup: true, sender: "123@lid", senderName: "Dan", text: "hi" }));
    contem(m, { grupo: { autor: null, autorNome: "Dan" } });
  });

  it("mídia sem legenda ganha rótulo", () => {
    const m = extrairMensagemUazapi(evento({ messageid: "X4", chatid: "447700900123@s.whatsapp.net", messageType: "ImageMessage", fileURL: "https://x/y.jpg" }));
    contem(m, { tipo: "image", texto: "Photo", midiaUrl: "https://x/y.jpg" });
  });
});

describe("extrairEdicaoUazapi", () => {
  it("edição aponta a original pelo `edited`, sem o dono do id", () => {
    const e = extrairEdicaoUazapi(evento({ messageid: "NOVO", chatid: "447700900123@s.whatsapp.net", fromMe: true, text: "No worries", edited: "4477:3EB0ORIG" }));
    assert.deepEqual(e, { alvo: "3EB0ORIG", texto: "No worries" });
  });

  it("mensagem comum não é edição", () => {
    assert.equal(extrairEdicaoUazapi(evento({ messageid: "A", chatid: "447700900123@s.whatsapp.net", text: "oi" })), null);
    assert.equal(extrairEdicaoUazapi(evento({ messageid: "A", chatid: "447700900123@s.whatsapp.net", edited: "X" })), null);
  });
});
