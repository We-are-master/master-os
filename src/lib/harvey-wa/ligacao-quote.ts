/**
 * Quem LIGOU pedindo quote recebe um WhatsApp logo depois da ligação (dono,
 * 13/10/2026: "pra quem liga no telefone e quer quote e preciso enviar msg pra
 * ela logo após").
 *
 * Na ligação não dá para ver o trabalho. O template pede as fotos e o postcode
 * no WhatsApp, que é onde o Harvey atende e onde o preço sai. Quem dispara é a
 * equipe, pela macro "Call: send quote WhatsApp" no ticket da ligação: nem toda
 * ligação é pedido de quote, então nada sai sozinho.
 */
import { zendeskApi, addTicketTags } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { idDaIntegracaoWhatsApp, telefoneE164 } from "./primeiro-contato";
import { scNotificacao } from "./sunshine";

const TEMPLATE = process.env.HARVEY_WA_CALL_QUOTE_TEMPLATE?.trim() || "phone_call_quote_followup";
const TYPE_OF_WORK = 5687087915551;
export const TAG_ENVIADO = "call_quote_wa_sent";
export const TAG_FALHOU = "call_quote_wa_failed";

type Ticket = { id: number; requester_id: number; tags: string[]; custom_fields: { id: number; value: string | null }[] };
type Usuario = { name: string | null; phone: string | null };
type Campo = { custom_field_options?: { name: string; value: string }[] };

/** "about {{2}}": o serviço do ticket quando a equipe já marcou, senão só "your job". */
export function sobreOQue(servico: string | null | undefined): string {
  const s = String(servico ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return s ? `your ${s} job` : "your job";
}

/** Nome que veio da ligação pode ser só o número ("Caller +44 7700 900123"): aí vira "there". */
export function nomeDeQuemLigou(nome: string | null | undefined): string {
  const n = String(nome ?? "").trim();
  if (!n || /\d{4,}/.test(n) || /^caller\b/i.test(n)) return "there";
  return firstName(n) ?? "there";
}

export type ResultadoDaLigacao = { ok: boolean; motivo: string };

export async function mandarQuoteDaLigacao(ticketId: string): Promise<ResultadoDaLigacao> {
  const { ticket } = await zendeskApi<{ ticket: Ticket }>(`tickets/${encodeURIComponent(ticketId)}.json`);
  if (!ticket) return { ok: false, motivo: "ticket not found" };
  if (ticket.tags.includes(TAG_ENVIADO)) return { ok: true, motivo: "already sent" };

  const { user } = await zendeskApi<{ user: Usuario }>(`users/${ticket.requester_id}.json`);
  const telefone = telefoneE164(user?.phone);
  const nota = (texto: string) => zendeskApi(`tickets/${ticket.id}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false } } } });
  if (!telefone) {
    await nota("Call follow-up NOT sent on WhatsApp: this contact has no usable mobile number. Add the phone to the contact and run the macro again, or send the details by email.");
    await addTicketTags(ticket.id, [TAG_FALHOU]);
    return { ok: false, motivo: "no phone" };
  }

  const valor = ticket.custom_fields.find((f) => f.id === TYPE_OF_WORK)?.value;
  let servico: string | null = null;
  if (valor) {
    const { ticket_field } = await zendeskApi<{ ticket_field: Campo }>(`ticket_fields/${TYPE_OF_WORK}.json`);
    servico = ticket_field?.custom_field_options?.find((o) => o.value === valor)?.name ?? null;
  }
  const nome = nomeDeQuemLigou(user?.name);
  const sobre = sobreOQue(servico);

  try {
    await scNotificacao({
      destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: telefone },
      author: { role: "appMaker" },
      messageSchema: "whatsapp",
      message: {
        type: "template",
        template: {
          namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
          name: TEMPLATE,
          language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
          components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: sobre }] }],
        },
      },
      metadata: { origem: "call_quote", ticket: String(ticket.id) },
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 200) : "failed";
    await nota(`Call follow-up NOT sent on WhatsApp to ${telefone}: ${erro}`);
    await addTicketTags(ticket.id, [TAG_FALHOU]);
    return { ok: false, motivo: erro };
  }

  await nota(
    `Call follow-up sent on WhatsApp to ${telefone} (${TEMPLATE}): "Hi ${nome}, thanks for calling Fixfy about ${sobre}. As agreed on the phone, this is where to send the details for your quote. Could you reply with a few photos of the job and your postcode? We'll come back to you here with a fixed price."\n\nNext action: the reply arrives in the WhatsApp conversation, where the price is given.`,
  );
  await addTicketTags(ticket.id, [TAG_ENVIADO]);
  return { ok: true, motivo: "sent" };
}
