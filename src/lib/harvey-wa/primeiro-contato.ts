/**
 * Primeiro contato do Harvey com um lead do Checkatrade, pelo WhatsApp do Zendesk.
 *
 * O lead nunca escreveu para a gente, então a Meta só aceita template aprovado
 * (fora da janela de 24 horas não existe mensagem livre). O template sai pela
 * Notification API do Sunshine com `messageSchema: "whatsapp"`: o Zendesk grava
 * a mensagem na conversa, e quando o cliente responde o Harvey já vê o que
 * mandamos e continua dali.
 *
 * Ordem, a mesma que o despacho do respond.io aprendeu a duras penas
 * (dispatch-one.ts): conferir se já falamos, enviar, e só então registrar.
 * Registro antes do envio tranca para sempre o lead cujo envio falhou.
 *
 * Ambiente (Vercel e .env.local da máquina dos scripts):
 *   HARVEY_WA_LEAD_TEMPLATE        nome do template aprovado (ex. checkatrade_lead_hello)
 *   HARVEY_WA_LEAD_TEMPLATE_LANG   idioma do template, padrão en_GB
 *   HARVEY_WA_TEMPLATE_NAMESPACE   só se o Zendesk pedir (WABA antiga)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decideDispatch } from "@/lib/agent/sales/dispatch-gate";
import { areaDoTemplate } from "@/lib/agent/sales/dispatch-one";
import { firstName, parseLeadBrief } from "@/lib/agent/sales/lead-brief";
import type { CatalogService } from "@/types/database";
import { chaveDoTelefone } from "./identidade";
import { scApi } from "./sunshine";

let integracaoWhatsApp: string | null = null;

/** O id da integração de WhatsApp do app no Sunshine (o número da Fixfy). */
async function idDaIntegracaoWhatsApp(): Promise<string> {
  if (integracaoWhatsApp) return integracaoWhatsApp;
  const fixo = process.env.HARVEY_WA_WHATSAPP_INTEGRATION_ID?.trim();
  if (fixo) return (integracaoWhatsApp = fixo);
  const r = await scApi<{ integrations: Array<{ id: string; type: string; status?: string }> }>("/integrations?filter[types]=whatsapp");
  const wa = (r.integrations ?? []).find((i) => i.type === "whatsapp" && i.status !== "inactive");
  if (!wa) throw new Error("Nenhuma integração de WhatsApp ativa no Sunshine");
  return (integracaoWhatsApp = wa.id);
}

export function templateDoLeadConfigurado(): boolean {
  return Boolean(process.env.HARVEY_WA_LEAD_TEMPLATE?.trim());
}

/** "+447700900123": o formato que o Sunshine quer no destinationId. */
export function telefoneE164(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) return `+${d}`;
  if (d.startsWith("0") && d.length >= 10) return `+44${d.slice(1)}`;
  if (d.startsWith("7") && d.length === 10) return `+44${d}`;
  return null;
}

/**
 * Já falamos com essa PESSOA? Vale qualquer um dos dois: um primeiro contato
 * registrado para o número, ou uma conversa viva com o Harvey no WhatsApp
 * (quem já escreveu não recebe "oi, vi seu pedido" por cima da conversa).
 */
export async function jaFalamosComEle(sb: SupabaseClient, telefone: string): Promise<boolean> {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return false;
  const fim = chave.slice(-4);
  const [{ data: envios }, { data: conversas }] = await Promise.all([
    sb.from("harvey_wa_leads").select("telefone").eq("chave", chave).limit(1),
    sb.from("harvey_wa_conversas").select("phone").ilike("phone", `%${fim}`).limit(50),
  ]);
  if ((envios ?? []).length) return true;
  return (conversas ?? []).some((c) => chaveDoTelefone(c.phone as string | null) === chave);
}

export type PrimeiroContato = {
  clienteId: string;
  telefone: string;
  nome: string;
  servico: string;
  area: string;
  leadExterno?: string | null;
};

export type ResultadoDoContato = { kind: "enviado"; notificacao: string | null } | { kind: "ja_falamos" } | { kind: "falhou"; motivo: string };

/** Manda o template de primeiro contato para UM lead e registra. Nunca lança. */
export async function mandarPrimeiroContato(sb: SupabaseClient, p: PrimeiroContato): Promise<ResultadoDoContato> {
  const nomeDoTemplate = process.env.HARVEY_WA_LEAD_TEMPLATE?.trim();
  if (!nomeDoTemplate) return { kind: "falhou", motivo: "HARVEY_WA_LEAD_TEMPLATE não configurado" };
  const destino = telefoneE164(p.telefone);
  if (!destino) return { kind: "falhou", motivo: `telefone inválido: ${p.telefone}` };
  try {
    if (await jaFalamosComEle(sb, destino)) return { kind: "ja_falamos" };
    const namespace = process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim();
    const r = await scApi<{ notification?: { _id?: string; id?: string } }>("/notifications", {
      method: "POST",
      body: {
        destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: destino },
        author: { role: "appMaker" },
        messageSchema: "whatsapp",
        message: {
          type: "template",
          template: {
            ...(namespace ? { namespace } : {}),
            name: nomeDoTemplate,
            language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
            components: [
              {
                type: "body",
                parameters: [p.nome, p.servico, p.area].map((text) => ({ type: "text", text })),
              },
            ],
          },
        },
        metadata: { origem: "checkatrade", clienteId: p.clienteId, ...(p.leadExterno ? { leadExterno: p.leadExterno } : {}) },
      },
    });
    const notificacao = r.notification?._id ?? r.notification?.id ?? null;
    await sb.from("harvey_wa_leads").upsert(
      { chave: chaveDoTelefone(destino), telefone: destino, cliente_id: p.clienteId, lead_externo: p.leadExterno ?? null, servico: p.servico, notificacao, enviado_em: new Date().toISOString() },
      { onConflict: "chave" },
    );
    return { kind: "enviado", notificacao };
  } catch (e) {
    return { kind: "falhou", motivo: e instanceof Error ? e.message.slice(0, 240) : "falhou" };
  }
}

export type LinhaDeCliente = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  address: string | null;
  notes: string | null;
};

export type DecisaoDoLead =
  | { kind: "mandar"; contato: PrimeiroContato }
  | { kind: "pular"; motivo: string };

/**
 * Lead do banco (clients) → o que vai no template, ou por que não vai. A
 * decisão (telefone, área coberta, serviço que vendemos) é a mesma do despacho
 * antigo: dispatch-gate.ts.
 */
export function decidirLead(r: LinhaDeCliente, catalogo: CatalogService[]): DecisaoDoLead {
  const brief = parseLeadBrief({ ...r, name: r.full_name });
  const d = decideDispatch(brief, catalogo);
  if (!d.dispatch) return { kind: "pular", motivo: d.reason };
  return {
    kind: "mandar",
    contato: {
      clienteId: r.id,
      telefone: brief.phone!,
      nome: firstName(brief.name) ?? "there",
      servico: d.label,
      area: areaDoTemplate(d.postcodeText),
      leadExterno: brief.externalId ?? null,
    },
  };
}
