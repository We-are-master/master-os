/**
 * O WhatsApp de operação (+44 7983 182332, WABA "Fixfy Support"): parceiros e
 * equipe. Está em coexistência: o app no celular continua, e a Meta manda ao
 * webhook do OS as mensagens recebidas, os ecos do que o celular enviou
 * (`smb_message_echoes`) e os status. Tudo vira linha em `wa_mensagens`, que a
 * tela /inbox lê. O número de clientes (4538) não passa por aqui.
 *
 * Ambiente:
 *   WHATSAPP_OPS_PHONE_NUMBER_ID  o id do 7983 (padrão 578637112002351)
 *   WHATSAPP_VERIFY_TOKEN         o mesmo segredo do aperto de mão; a URL de
 *                                 retorno do 7983 leva `?k=<segredo>`, porque o
 *                                 segredo do app (assinatura) não está conosco
 *   WHATSAPP_TOKEN                o token do system user (o mesmo do 4538)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const OPS_PHONE_NUMBER_ID = () => process.env.WHATSAPP_OPS_PHONE_NUMBER_ID?.trim() || "578637112002351";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Fora da janela de 24h só sai template; estes dois servem para parceiro. */
export const TEMPLATES_OPERACAO = {
  no_response_followup: { vars: ["name"] },
  conversation_follow_up: { vars: ["name", "subject"] },
} as const;
export type TemplateOperacao = keyof typeof TEMPLATES_OPERACAO;

/** A chave da URL de retorno confere com o segredo? Sem segredo configurado, não confia. */
export function chaveDoRetornoOk(k: string | null): boolean {
  const segredo = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  return Boolean(segredo && k && k === segredo);
}

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Os últimos 10 dígitos casam 07…, 447… e +44 7… do mesmo celular. */
export const finalDoNumero = (s: unknown) => digitos(s).slice(-10);

/**
 * Filtro do PostgREST que acha o número com espaço, traço ou parêntese no meio.
 * O `ilike %<9 dígitos>%` não achava `+44 7xxxx xxxxx` (39% dos clientes estão
 * assim): os dígitos não ficam juntos no texto. Aqui são os últimos 9 dígitos com
 * qualquer não-dígito entre eles; quem chama confere o número inteiro depois.
 */
export const filtroDoNumero = (campo: string, s: unknown) => `${campo}.imatch.${digitos(s).slice(-9).split("").join("\\D*")}`;

type MensagemMeta = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string; filename?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  template?: { name?: string };
};

type StatusMeta = { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string }[] };

export type ValorDoWebhook = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
  message_echoes?: MensagemMeta[];
  statuses?: StatusMeta[];
};

/** O que mostrar de cada tipo: texto quando há, senão um rótulo curto. */
export function textoDaMensagem(m: MensagemMeta): string | null {
  if (m.text?.body) return m.text.body;
  if (m.button) return m.button.text ?? m.button.payload ?? null;
  if (m.interactive) return m.interactive.button_reply?.title ?? m.interactive.list_reply?.title ?? null;
  const midia = m.image ?? m.video ?? m.document;
  if (midia?.caption) return midia.caption;
  if (m.document?.filename) return m.document.filename;
  if (m.location) return [m.location.name, m.location.address].filter(Boolean).join(", ") || "Location";
  if (m.template?.name) return `Template: ${m.template.name}`;
  return null;
}

const midiaDaMensagem = (m: MensagemMeta) => (m.image ?? m.video ?? m.document ?? m.audio ?? m.sticker)?.id ?? null;

const quando = (ts?: string) => (ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString());

/** Acha o parceiro pelo celular (whatsapp primeiro, depois phone). */
async function parceiroDoNumero(sb: SupabaseClient, numero: string): Promise<string | null> {
  const fim = finalDoNumero(numero);
  if (fim.length < 10) return null;
  const { data } = await sb
    .from("partners")
    .select("id, whatsapp, phone")
    .or(`${filtroDoNumero("whatsapp", fim)},${filtroDoNumero("phone", fim)}`)
    .limit(10);
  const achado = (data ?? []).find((p) => finalDoNumero(p.whatsapp) === fim || finalDoNumero(p.phone) === fim);
  return (achado?.id as string | undefined) ?? null;
}

/**
 * Grava um `value` do webhook do 7983. Mensagem repetida (a Meta reenvia) não
 * duplica, pelo wamid. Status só avança: `read` não volta para `delivered`.
 */
export async function gravarEventoOperacao(sb: SupabaseClient, valor: ValorDoWebhook): Promise<void> {
  const phoneNumberId = valor.metadata?.phone_number_id ?? OPS_PHONE_NUMBER_ID();
  const nomes = new Map((valor.contacts ?? []).map((c) => [digitos(c.wa_id), c.profile?.name ?? null]));
  const parceiros = new Map<string, string | null>();
  const parceiroDe = async (numero: string) => {
    if (!parceiros.has(numero)) parceiros.set(numero, await parceiroDoNumero(sb, numero));
    return parceiros.get(numero) ?? null;
  };

  const linhas: Record<string, unknown>[] = [];
  for (const m of valor.messages ?? []) {
    const contato = digitos(m.from);
    if (!contato) continue;
    linhas.push({
      wamid: m.id ?? null,
      phone_number_id: phoneNumberId,
      contato,
      contato_nome: nomes.get(contato) ?? null,
      direcao: "entrada",
      origem: "contato",
      tipo: m.type ?? "text",
      texto: textoDaMensagem(m),
      midia_id: midiaDaMensagem(m),
      partner_id: await parceiroDe(contato),
      criado_em: quando(m.timestamp),
      bruto: m,
    });
  }
  // Eco: o que alguém mandou pelo app no celular. `to` é o contato.
  for (const m of valor.message_echoes ?? []) {
    const contato = digitos(m.to);
    if (!contato) continue;
    linhas.push({
      wamid: m.id ?? null,
      phone_number_id: phoneNumberId,
      contato,
      direcao: "saida",
      origem: "celular",
      tipo: m.type ?? "text",
      texto: textoDaMensagem(m),
      midia_id: midiaDaMensagem(m),
      status: "sent",
      partner_id: await parceiroDe(contato),
      criado_em: quando(m.timestamp),
      bruto: m,
    });
  }
  if (linhas.length) {
    const { error } = await sb.from("wa_mensagens").upsert(linhas, { onConflict: "wamid", ignoreDuplicates: true });
    if (error) console.error("[whatsapp-operacao] gravar mensagens", error.message);
  }

  const ORDEM = ["sent", "delivered", "read"];
  for (const s of valor.statuses ?? []) {
    if (!s.id || !s.status) continue;
    if (s.status === "failed") {
      const e = s.errors?.[0];
      await sb
        .from("wa_mensagens")
        .update({ status: "failed", erro: e ? `${e.code ?? ""} ${e.message ?? e.title ?? ""}`.trim() : null })
        .eq("wamid", s.id);
      continue;
    }
    const pos = ORDEM.indexOf(s.status);
    if (pos < 0) continue;
    // Só avança: quem já está num status igual ou à frente fica como está.
    await sb
      .from("wa_mensagens")
      .update({ status: s.status })
      .eq("wamid", s.id)
      .or(`status.is.null,status.in.(${ORDEM.slice(0, pos).join(",") || "none"})`);
  }
}

export class EnvioOperacaoError extends Error {
  constructor(message: string, readonly code: number | null = null) {
    super(message);
    this.name = "EnvioOperacaoError";
  }
}

/** Manda pelo 7983: texto livre (dentro das 24h) ou um dos templates de parceiro. */
export async function enviarPelaOperacao(input: {
  para: string;
  texto?: string;
  template?: { nome: TemplateOperacao; params: string[] };
}): Promise<{ wamid: string; corpo: Record<string, unknown> }> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  if (!token) throw new EnvioOperacaoError("WHATSAPP_TOKEN is not set");
  const para = digitos(input.para);
  if (para.length < 11) throw new EnvioOperacaoError(`Invalid WhatsApp number: ${input.para}`);

  const corpo: Record<string, unknown> = input.template
    ? {
        messaging_product: "whatsapp",
        to: para,
        type: "template",
        template: {
          name: input.template.nome,
          language: { code: "en" },
          components: [{ type: "body", parameters: input.template.params.map((text) => ({ type: "text", text })) }],
        },
      }
    : { messaging_product: "whatsapp", to: para, type: "text", text: { body: input.texto ?? "", preview_url: false } };

  const res = await fetch(`${GRAPH}/${OPS_PHONE_NUMBER_ID()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !json.messages?.[0]?.id) {
    throw new EnvioOperacaoError(json.error?.message ?? `WhatsApp ${res.status}`, json.error?.code ?? null);
  }
  return { wamid: json.messages[0].id, corpo };
}
