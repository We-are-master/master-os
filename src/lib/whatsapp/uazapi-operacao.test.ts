import { describe, expect, it } from "vitest";
import { extrairMensagemUazapi } from "./uazapi-operacao";

const evento = (message: Record<string, unknown>) => ({ EventType: "messages", message });

describe("extrairMensagemUazapi", () => {
  it("mensagem do parceiro vira entrada com nome e hora em ms", () => {
    const m = extrairMensagemUazapi(
      evento({ messageid: "ABC", chatid: "447700900123@s.whatsapp.net", fromMe: false, text: "On my way", senderName: "Dan", messageTimestamp: 1762130000000, messageType: "Conversation" }),
    );
    expect(m).toMatchObject({ wamid: "ABC", contato: "447700900123", direcao: "entrada", tipo: "text", texto: "On my way", contatoNome: "Dan" });
    expect("criadoEm" in m && m.criadoEm).toBe(new Date(1762130000000).toISOString());
  });

  it("o que saiu pelo celular entra como saída, sem nome do contato", () => {
    const m = extrairMensagemUazapi(evento({ messageid: "X1", chatid: "447700900123@s.whatsapp.net", fromMe: true, text: "ok" }));
    expect(m).toMatchObject({ direcao: "saida", contatoNome: null });
  });

  it("pula o que o OS mandou, grupo e evento que não é mensagem", () => {
    expect(extrairMensagemUazapi(evento({ messageid: "X2", chatid: "447700900123@s.whatsapp.net", fromMe: true, wasSentByApi: true, text: "hi" }))).toEqual({ pular: "enviada pelo OS" });
    expect(extrairMensagemUazapi(evento({ messageid: "X3", chatid: "1203630@g.us", isGroup: true, text: "hi" }))).toEqual({ pular: "grupo ou broadcast" });
    expect(extrairMensagemUazapi({ EventType: "connection" })).toEqual({ pular: "evento connection" });
  });

  it("mídia sem legenda ganha rótulo", () => {
    const m = extrairMensagemUazapi(evento({ messageid: "X4", chatid: "447700900123@s.whatsapp.net", messageType: "ImageMessage", fileURL: "https://x/y.jpg" }));
    expect(m).toMatchObject({ tipo: "image", texto: "Photo", midiaUrl: "https://x/y.jpg" });
  });
});
