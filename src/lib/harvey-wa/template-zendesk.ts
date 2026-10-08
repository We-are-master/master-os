/**
 * Template de WhatsApp pelo número do Zendesk (020 4538 4668), no mesmo
 * formato do `sendTemplate` da Cloud API, para trocar um pelo outro sem mexer
 * em quem chama.
 *
 * Por que existe: a Cloud API direta (WHATSAPP_TOKEN) perdeu a permissão de
 * mandar pela conta (erro #200, 08/10/2026) e o lembrete de véspera falhou para
 * todos os clientes de amanhã. O número do Zendesk já manda os templates dos
 * leads pelo Sunshine, e a resposta do cliente cai na conversa que a equipe e
 * o Harvey já acompanham.
 */
import { idDaIntegracaoWhatsApp, telefoneE164 } from "./primeiro-contato";
import { scNotificacao } from "./sunshine";
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp/cloud";

/** Mesmo namespace dos templates dos leads (a conta de WhatsApp do Zendesk). */
const namespace = () =>
  process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542";

export function zendeskWhatsAppConfigurado(): boolean {
  return Boolean(
    process.env.SUNSHINE_APP_ID?.trim() && process.env.SUNSHINE_KEY_ID?.trim() && process.env.SUNSHINE_KEY_SECRET?.trim(),
  );
}

export async function enviarTemplatePeloZendesk(input: {
  to: string;
  name: string;
  language?: string;
  bodyParams?: string[];
}): Promise<{ messageId: string; to: string }> {
  const destino = telefoneE164(input.to);
  if (!destino) throw new Error(`invalid WhatsApp number: ${input.to}`);
  const r = await scNotificacao<{ notification?: { _id?: string; id?: string } }>({
    destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: destino },
    author: { role: "appMaker" },
    messageSchema: "whatsapp",
    message: {
      type: "template",
      template: {
        namespace: namespace(),
        name: input.name,
        language: { policy: "deterministic", code: input.language || "en_GB" },
        components: input.bodyParams?.length
          ? [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) }]
          : [],
      },
    },
    metadata: { origem: input.name },
  });
  return { messageId: r.notification?._id ?? r.notification?.id ?? "", to: destino };
}

/**
 * Canal único das mensagens ao cliente (confirmação, remarcação, lembrete de
 * véspera, feedback): o número do Zendesk por padrão; `CLIENT_WA_VIA=cloud`
 * volta para a Cloud API direta.
 */
export const clientePelaCloud = () => process.env.CLIENT_WA_VIA?.trim() === "cloud";

export function enviarAoCliente(input: Parameters<typeof sendTemplate>[0]): ReturnType<typeof sendTemplate> {
  return clientePelaCloud() ? sendTemplate(input) : enviarTemplatePeloZendesk(input);
}

export function canalDoClienteConfigurado(): boolean {
  return clientePelaCloud() ? whatsappConfigured() : zendeskWhatsAppConfigurado();
}

export function canalDoClienteFaltando(): string {
  return clientePelaCloud()
    ? "WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)"
    : "Zendesk WhatsApp is not configured (SUNSHINE_APP_ID, SUNSHINE_KEY_ID, SUNSHINE_KEY_SECRET)";
}
