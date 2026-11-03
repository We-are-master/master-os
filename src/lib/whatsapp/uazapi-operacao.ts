/**
 * O 7983 pela uazapi (não oficial, ponte de WhatsApp Web): a instância entra
 * como "aparelho conectado" no celular, então o app continua lá, com histórico
 * e grupos. Sem regra de 24h e sem template. O risco é ban por ser não
 * oficial: serve para conversa 1 a 1 com parceiro, nunca para disparo.
 *
 * Grava nas mesmas linhas de `wa_mensagens` (chave `OPS_PHONE_NUMBER_ID`), de
 * modo que a tela /inbox não muda e o histórico do oficial continua junto.
 *
 * Ambiente:
 *   WHATSAPP_OPS_PROVIDER        `uazapi` | `meta`; sem ela, uazapi se houver token
 *   UAZAPI_OPS_BASE_URL          servidor da instância (padrão osvertex.uazapi.com)
 *   UAZAPI_OPS_TOKEN             token da INSTÂNCIA do 7983 (não o admin)
 *   UAZAPI_OPS_WEBHOOK_SECRET    a URL do webhook leva `?k=<segredo>`; a uazapi
 *                                não assina o corpo, então é o que existe
 */

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EnvioOperacaoError, OPS_PHONE_NUMBER_ID, finalDoNumero } from "./operacao";

export type ProvedorOperacao = "uazapi" | "meta";

export function provedorDaOperacao(): ProvedorOperacao {
  const p = process.env.WHATSAPP_OPS_PROVIDER?.trim().toLowerCase();
  if (p === "uazapi" || p === "meta") return p;
  return process.env.UAZAPI_OPS_TOKEN?.trim() ? "uazapi" : "meta";
}

const baseUrl = () => (process.env.UAZAPI_OPS_BASE_URL?.trim() || "https://osvertex.uazapi.com").replace(/\/+$/, "");

/** Segredo da URL do webhook, em tempo constante. Sem segredo (ou curto), nega. */
export function chaveUazapiOk(k: string | null): boolean {
  const segredo = process.env.UAZAPI_OPS_WEBHOOK_SECRET?.trim();
  if (!segredo || segredo.length < 24 || !k) return false;
  const a = Buffer.from(k);
  const b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Tipos do uazapiGO → o `tipo` que a tela já conhece. */
const TIPO: Record<string, string> = {
  text: "text", chat: "text", conversation: "text", extendedtextmessage: "text",
  image: "image", imagemessage: "image",
  audio: "audio", audiomessage: "audio", ptt: "audio",
  video: "video", videomessage: "video",
  document: "document", documentmessage: "document",
  sticker: "sticker", stickermessage: "sticker",
  location: "location", locationmessage: "location",
};

const ROTULO: Record<string, string> = {
  image: "Photo", audio: "Voice note", video: "Video", document: "Document", sticker: "Sticker", location: "Location",
};

export type MensagemUazapi = {
  wamid: string;
  contato: string;
  contatoNome: string | null;
  direcao: "entrada" | "saida";
  tipo: string;
  texto: string | null;
  midiaUrl: string | null;
  criadoEm: string;
  bruto: Record<string, unknown>;
};

/**
 * Traduz um evento da uazapi numa mensagem, ou diz por que não vira. Pura,
 * para as recusas serem testáveis: grupo e broadcast ficam fora (a caixa é 1 a
 * 1), e o que o próprio OS mandou (`wasSentByApi`) já foi gravado no envio.
 * O que alguém mandou pelo celular (`fromMe` sem API) entra como saída.
 */
export function extrairMensagemUazapi(payload: unknown): MensagemUazapi | { pular: string } {
  const p = rec(payload) ?? {};
  const evento = String(p.EventType ?? p.event ?? "messages").toLowerCase();
  if (evento !== "messages") return { pular: `evento ${evento}` };
  const m = rec(p.message) ?? rec(p.data) ?? p;
  const key = rec(m.key) ?? {};

  const wamid = str(m.messageid) ?? str(m.messageId) ?? str(key.id) ?? str(m.id);
  const jid = str(m.chatid) ?? str(m.wa_chatid) ?? str(key.remoteJid) ?? str(m.from) ?? "";
  if (!wamid || !jid) return { pular: "sem id ou jid" };
  if (m.isGroup === true || jid.endsWith("@g.us") || /@(newsletter|broadcast)$/.test(jid)) return { pular: "grupo ou broadcast" };
  if (m.wasSentByApi === true) return { pular: "enviada pelo OS" };

  const contato = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!contato) return { pular: "jid sem telefone" };

  const daCasa = Boolean(m.fromMe ?? key.fromMe);
  const tipo = TIPO[(str(m.messageType) ?? str(m.type) ?? "text").toLowerCase()] ?? "text";
  const texto = str(m.text) ?? str(m.body) ?? str(m.caption) ?? str(rec(m.content)?.text) ?? ROTULO[tipo] ?? null;
  const ts = Number(m.messageTimestamp ?? m.timestamp ?? 0);
  // O uazapiGO manda em milissegundos; versões antigas, em segundos.
  const criadoEm = ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString() : new Date().toISOString();

  return {
    wamid,
    contato,
    contatoNome: daCasa ? null : str(m.senderName) ?? str(m.pushName) ?? null,
    direcao: daCasa ? "saida" : "entrada",
    tipo,
    texto,
    midiaUrl: str(m.fileURL) ?? str(m.fileUrl) ?? str(m.mediaUrl) ?? null,
    criadoEm,
    bruto: m,
  };
}

async function parceiroDoNumero(sb: SupabaseClient, numero: string): Promise<string | null> {
  const fim = finalDoNumero(numero);
  if (fim.length < 10) return null;
  const { data } = await sb
    .from("partners")
    .select("id, whatsapp, phone")
    .or(`whatsapp.ilike.%${fim.slice(-9)}%,phone.ilike.%${fim.slice(-9)}%`)
    .limit(10);
  const achado = (data ?? []).find((p) => finalDoNumero(p.whatsapp) === fim || finalDoNumero(p.phone) === fim);
  return (achado?.id as string | undefined) ?? null;
}

/** Grava um evento da uazapi. Reentrega não duplica, pelo wamid. */
export async function gravarEventoUazapi(sb: SupabaseClient, payload: unknown): Promise<string> {
  const presenca = extrairPresencaUazapi(payload);
  if (presenca) {
    const { error } = await sb
      .from("inbox_conversas")
      .upsert({ contato: presenca.contato, presenca: presenca.estado, presenca_em: new Date().toISOString() }, { onConflict: "contato" });
    if (error) console.error("[uazapi-operacao] presença", error.message);
    return `presença ${presenca.estado}`;
  }
  const m = extrairMensagemUazapi(payload);
  if ("pular" in m) return m.pular;
  // Sem "baixar mídia" ligado na instância o evento chega sem URL: pede uma.
  if (!m.midiaUrl && ["image", "audio", "video", "document", "sticker"].includes(m.tipo)) {
    m.midiaUrl = await urlDaMidia(m.wamid);
  }
  const { error } = await sb.from("wa_mensagens").upsert(
    {
      wamid: m.wamid,
      phone_number_id: OPS_PHONE_NUMBER_ID(),
      contato: m.contato,
      contato_nome: m.contatoNome,
      direcao: m.direcao,
      origem: m.direcao === "entrada" ? "contato" : "celular",
      tipo: m.tipo,
      texto: m.texto,
      midia_id: m.midiaUrl,
      status: m.direcao === "saida" ? "sent" : null,
      partner_id: await parceiroDoNumero(sb, m.contato),
      criado_em: m.criadoEm,
      bruto: m.bruto,
    },
    { onConflict: "wamid", ignoreDuplicates: true },
  );
  if (error) console.error("[uazapi-operacao] gravar", error.message);
  return error ? "erro" : "gravada";
}

/** Manda texto pelo 7983 via uazapi. Devolve o id que o webhook também usa. */
export async function enviarPelaUazapi(para: string, texto: string): Promise<{ wamid: string; corpo: Record<string, unknown> }> {
  const token = process.env.UAZAPI_OPS_TOKEN?.trim();
  if (!token) throw new EnvioOperacaoError("UAZAPI_OPS_TOKEN is not set");
  const numero = para.replace(/\D/g, "");
  if (numero.length < 11) throw new EnvioOperacaoError(`Invalid WhatsApp number: ${para}`);

  const corpo = { number: numero, text: texto };
  const res = await fetch(`${baseUrl()}/send/text`, {
    method: "POST",
    headers: { token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corpo),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const wamid = str(json.messageid) ?? str(json.messageId) ?? str(rec(json.key)?.id) ?? str(json.id);
  if (!res.ok || !wamid) {
    throw new EnvioOperacaoError(str(json.error) ?? str(json.message) ?? `uazapi ${res.status}`, res.status);
  }
  return { wamid, corpo };
}

/**
 * Presença do contato (online, digitando, saiu). O uazapiGO repassa o evento
 * do WhatsApp Web, que muda de forma entre versões; lê o que der e ignora o
 * resto. Grupo fica fora como nas mensagens.
 */
export function extrairPresencaUazapi(payload: unknown): { contato: string; estado: "online" | "digitando" | "gravando" | "offline" } | null {
  const p = rec(payload) ?? {};
  const evento = String(p.EventType ?? p.event ?? "").toLowerCase();
  if (!evento.includes("presence")) return null;
  const e = rec(p.event) ?? rec(p.data) ?? rec(p.presence) ?? p;
  const jid = str(e.From) ?? str(e.from) ?? str(e.Chat) ?? str(e.chat) ?? str(e.chatid) ?? str(e.Sender) ?? str(e.id) ?? str(p.chatid) ?? "";
  if (!jid || jid.endsWith("@g.us")) return null;
  const contato = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (contato.length < 10) return null;
  const bruto = String(e.State ?? e.state ?? e.Presence ?? e.presence ?? e.lastKnownPresence ?? "").toLowerCase();
  if (e.Unavailable === true || bruto === "unavailable") return { contato, estado: "offline" };
  if (bruto === "composing") return { contato, estado: "digitando" };
  if (bruto === "recording") return { contato, estado: "gravando" };
  if (bruto === "available" || bruto === "paused" || e.Unavailable === false) return { contato, estado: "online" };
  return null;
}

function cabecalho(): Record<string, string> {
  const token = process.env.UAZAPI_OPS_TOKEN?.trim();
  if (!token) throw new EnvioOperacaoError("UAZAPI_OPS_TOKEN is not set");
  return { token, "Content-Type": "application/json", Accept: "application/json" };
}

/** Pede à uazapi a URL de uma mídia recebida. Sem ela, a mensagem fica só com o rótulo. */
async function urlDaMidia(messageid: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl()}/message/download`, {
      method: "POST",
      headers: cabecalho(),
      body: JSON.stringify({ id: messageid, return_link: true }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return str(json.fileURL) ?? str(json.fileUrl) ?? str(json.url) ?? null;
  } catch {
    return null;
  }
}

export type TipoDeMidia = "image" | "video" | "document" | "ptt" | "audio";

/**
 * Manda arquivo pelo 7983. A legenda vai em `text` (a uazapi ignora `caption`
 * em silêncio; o VOS aprendeu isso com 202 legendas perdidas). Voz é `ptt`:
 * chega como áudio gravado, não como arquivo.
 */
export async function enviarMidiaPelaUazapi(
  para: string,
  tipo: TipoDeMidia,
  url: string,
  legenda?: string,
  nomeDoArquivo?: string,
): Promise<{ wamid: string; corpo: Record<string, unknown> }> {
  const numero = para.replace(/\D/g, "");
  if (numero.length < 11) throw new EnvioOperacaoError(`Invalid WhatsApp number: ${para}`);
  const corpo = {
    number: numero,
    type: tipo,
    file: url,
    ...(legenda ? { text: legenda } : {}),
    ...(nomeDoArquivo ? { docName: nomeDoArquivo } : {}),
  };
  const res = await fetch(`${baseUrl()}/send/media`, { method: "POST", headers: cabecalho(), body: JSON.stringify(corpo) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const wamid = str(json.messageid) ?? str(json.messageId) ?? str(rec(json.key)?.id) ?? str(json.id);
  if (!res.ok || !wamid) {
    throw new EnvioOperacaoError(str(json.error) ?? str(json.message) ?? `uazapi ${res.status}`, res.status);
  }
  return { wamid, corpo: { ...corpo, file: "(signed url)" } };
}

/** O 7983 está conectado agora? Lê o estado da instância na uazapi. */
export async function statusDaInstancia(): Promise<{ conectado: boolean; estado: string }> {
  try {
    const res = await fetch(`${baseUrl()}/instance/status`, { headers: cabecalho(), cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const inst = rec(json.instance) ?? {};
    const st = rec(json.status) ?? {};
    const estado = String(inst.status ?? json.status ?? "unknown");
    const conectado = st.connected === true || estado === "connected";
    return { conectado, estado: conectado ? "connected" : estado };
  } catch {
    return { conectado: false, estado: "unreachable" };
  }
}

/** Avisa o WhatsApp que a conversa foi lida (os dois tiques azuis do lado do contato). */
export async function marcarLidaNaUazapi(contato: string): Promise<void> {
  try {
    await fetch(`${baseUrl()}/chat/read`, {
      method: "POST",
      headers: cabecalho(),
      body: JSON.stringify({ number: `${contato.replace(/\D/g, "")}@s.whatsapp.net`, read: true }),
    });
  } catch {
    /* best effort */
  }
}
