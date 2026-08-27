/**
 * Despacha UM lead para o Mike: contato, template, atribuição e estágio.
 *
 * Vive aqui, e não dentro do script, porque tem dois chamadores com pressas
 * diferentes. O `scripts/sales-dispatch.mts` varre o acumulado em lote, com
 * espaçamento e teto diário. A rota `/api/contacts/ingest` chama um de cada vez,
 * no instante em que o RPA marca "I'm interested" no Checkatrade, e é isso que
 * tira o tempo até o primeiro contato de vinte minutos para segundos.
 *
 * A ordem das chamadas não é arbitrária, e cada passo custou um incidente:
 *
 *   1. contato SEM o marcador de dedupe
 *   2. template
 *   3. conferir a entrega
 *   4. só então o marcador
 *   5. estágio e atribuição
 *
 * Gravar o marcador antes do envio (como era até 2026-08-12) deixa o lead
 * marcado como falado quando o envio falha, e ele nunca mais é tentado: 949
 * leads pagos ficaram assim em uma tarde. E o `200` do envio não é entrega, o
 * status vira `failed` segundos depois.
 */

import {
  createRespondIoClient,
  phoneIdentifier,
  RespondIoError,
  type RespondIoClient,
} from "@/lib/respond-io/client";
import { tradeSlugParaRespondIo } from "./service-match";
import type { DispatchDecision } from "./dispatch-gate";
import type { LeadBrief } from "./lead-brief";

/** Erros da CONTA, não do destinatário. Param o lote; os outros não. */
export const FALHA_DE_CONTA =
  /insufficient funds|deactivated|account.*(suspend|restrict|disabl)|payment method|balance/i;

export class ContaBloqueada extends Error {}

export type ResultadoDespacho =
  | { kind: "enviado"; messageId: number }
  | { kind: "ja_falamos" }
  | { kind: "nao_entregue"; motivo: string };

export type OpcoesDespacho = {
  template: string;
  languageCode?: string;
  channelId: number;
  agentUserId: number;
  estagioInicial?: string;
  /** Segundos de espera antes de conferir a entrega. */
  esperaEntrega?: number;
  client?: RespondIoClient;
};

/**
 * Terceira variável do template. O exemplo aprovado é "NW8 area", e a frase é
 * "I saw your request on Checkatrade for X in {{3}}". O postcode cru faria sair
 * "in London SE5 8HY, UK", que lê como etiqueta de encomenda.
 */
export function areaDoTemplate(postcode: string): string {
  // Chega sem espaço ("SE12LP"), e um regex de outward code não separa
  // "SE1"+"2LP" de "SE12"+"LP" sozinho. No Reino Unido o inward code é sempre
  // três caracteres (dígito + duas letras); o outward é o resto.
  const completo = postcode.toUpperCase().match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/);
  if (completo) return `${completo[0].replace(/\s+/g, "").slice(0, -3)} area`;
  const parcial = postcode.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/);
  return parcial ? `${parcial[1]} area` : postcode;
}

/** O campo `enquiry` recusa acima de 255 caracteres e recusa emoji. */
export function paraCampoTexto(v: string | null | undefined, max = 255): string {
  const semEmoji = (v ?? "").replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu,
    "",
  );
  const limpo = semEmoji.replace(/\s+/g, " ").trim();
  return limpo.length <= max ? limpo : `${limpo.slice(0, max - 1).trimEnd()}…`;
}

const dorme = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * "Já falamos com esta pessoa?" exige **mensagem entregue**, não marcador.
 *
 * O marcador sozinho responde "alguém tentou", que é outra pergunta. Depois do
 * incidente de 2026-08-12 havia 1013 contatos marcados para 37 entregas, e um
 * dedupe por marcador teria trancado os outros 976 para sempre.
 *
 * A pergunta é sobre a PESSOA, não sobre o lead. Até 24/08/2026 exigia-se que
 * o marcador gravado fosse o MESMO lead (`v === leadId`), e com isso a mesma
 * pessoa voltando ao board do Checkatrade com uma oportunidade nova levava a
 * mensagem de primeiro contato de novo, por cima de uma conversa viva. O
 * `leadId` continua no parâmetro porque o chamador tem, mas ele não decide
 * mais: qualquer marcador mais entrega já responde "sim, já falamos".
 */
export async function jaFalamos(client: RespondIoClient, phone: string, _leadId?: string | null) {
  try {
    const c = await client.getContact(phoneIdentifier(phone));
    const v = c.custom_fields?.find((f) => f.name === "checkatrade_lead_id")?.value;
    if (!(typeof v === "string" && v.length > 0)) return false;
    const msgs = await client.messages(phoneIdentifier(phone), 20);
    return msgs.some((m) => (m.status ?? []).some((s) => ["delivered", "read", "sent"].includes(s.value)));
  } catch (err) {
    // 404 é o caso normal: contato não existe, lead é novo.
    if (err instanceof RespondIoError && err.status === 404) return false;
    throw err;
  }
}

export async function despacharUm(
  brief: LeadBrief,
  decisao: Extract<DispatchDecision, { dispatch: true }>,
  nome: string,
  opts: OpcoesDespacho,
): Promise<ResultadoDespacho> {
  const respond = opts.client ?? createRespondIoClient();
  const id = phoneIdentifier(brief.phone!);

  if (await jaFalamos(respond, brief.phone!, brief.externalId)) return { kind: "ja_falamos" };

  const slug = tradeSlugParaRespondIo(decisao.service);
  await respond.createOrUpdateContact(id, {
    firstName: nome,
    phone: brief.phone,
    email: brief.email,
    custom_fields: [
      ...(slug ? [{ name: "trade", value: slug }] : []),
      { name: "enquiry", value: paraCampoTexto(brief.enquiry) },
      { name: "postcode", value: decisao.postcodeText },
      { name: "coverage_tier", value: decisao.coverage },
      { name: "materials_included", value: "unknown" },
    ],
  });

  const msg = await respond.sendTemplate(
    id,
    {
      name: opts.template,
      languageCode: opts.languageCode ?? "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: nome },
            { type: "text", text: decisao.label },
            { type: "text", text: areaDoTemplate(decisao.postcodeText) },
          ],
        },
      ],
    },
    opts.channelId,
  );

  await dorme(opts.esperaEntrega ?? 4);
  const status = await respond.messageStatus(id, msg.messageId);
  const falhou = status.find((s) => s.value === "failed");
  if (falhou) {
    if (FALHA_DE_CONTA.test(falhou.message ?? "")) throw new ContaBloqueada(falhou.message ?? "conta bloqueada");
    return { kind: "nao_entregue", motivo: falhou.message ?? "sem motivo" };
  }

  await respond.createOrUpdateContact(id, {
    firstName: nome,
    custom_fields: [{ name: "checkatrade_lead_id", value: brief.externalId ?? "" }],
  });

  // Estágio e atribuição são observabilidade e roteamento, não entrega. Uma
  // falha aqui não pode desfazer uma mensagem que já chegou ao cliente.
  try {
    await respond.setLifecycle(id, opts.estagioInicial ?? "New Lead");
  } catch {
    // segue
  }
  try {
    await respond.assignConversation(id, opts.agentUserId);
  } catch (err) {
    // "already assigned" volta como 400, não como 200.
    if (!(err instanceof RespondIoError && /already assigned/i.test(err.body))) throw err;
  }

  return { kind: "enviado", messageId: msg.messageId };
}

/** Janela em que é aceitável mandar WhatsApp para consumidor em Londres. */
export function dentroDaJanela(min = 8, max = 20): boolean {
  const hora = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(
      new Date(),
    ),
  );
  return hora >= min && hora < max;
}
