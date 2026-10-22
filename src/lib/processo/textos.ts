/**
 * Todo texto NOVO que o cliente (ou a plataforma) lê nos fluxos v2 das
 * plataformas (plano do dono, 22/10/2026). Um arquivo só, para o dono aprovar
 * antes de ligar `process_rules.v2` em qualquer conta.
 *
 * Regras da casa: inglês do Reino Unido, sem travessão (em dash), sem nome de
 * plataforma no conteúdo do job. Placeholders `{{nome}}` são preenchidos por
 * `preencherTexto`; valor que falta vira string vazia, nunca "undefined".
 */

/** Express (Checkatrade): e-mail de boas-vindas com os dados do booking, no ticket do job. */
export const EXPRESS_BOAS_VINDAS_ASSUNTO = "Your booking {{referencia}} is confirmed with Fixfy";

export const EXPRESS_BOAS_VINDAS_HTML = [
  "<p>Hi {{primeiroNome}},</p>",
  "<p>Thank you for your booking. Fixfy is now looking after it for you, and this is the email where we will keep you updated.</p>",
  "<p><strong>Your booking</strong><br>",
  "Reference: {{referencia}}<br>",
  "Service: {{servico}}<br>",
  "Date: {{data}}<br>",
  "Arrival window: {{janela}}<br>",
  "Address: {{endereco}}</p>",
  "<p>We will confirm your professional before the visit. If anything changes or you have a question, just reply to this email.</p>",
  "<p>Kind regards,<br>Fixfy Team</p>",
].join("\n");

/** Quando o dia ou a janela ainda não estão confirmados. */
export const TEXTO_A_CONFIRMAR = "to be confirmed";

/**
 * Housekeep: 36h depois do primeiro convite sem lance viável e sem resposta da
 * equipe. Vai como resposta pública no ticket da quote (a Housekeep é quem pediu).
 */
export const HOUSEKEEP_SEM_DISPONIBILIDADE_HTML = [
  "<p>Hi there,</p>",
  "<p>Thank you for sending us this request{{referenciaEntreParenteses}}.</p>",
  "<p>Unfortunately we do not have a professional available to take on this job at the moment, so we are unable to quote for it this time.</p>",
  "<p>Please keep sending us future requests. We will be happy to help.</p>",
  "<p>Kind regards,<br>Fixfy Team</p>",
].join("\n");

/** Motivo gravado em quotes.rejection_reason (interno, mas fica legível na tela de Quotes). */
export const HOUSEKEEP_SEM_DISPONIBILIDADE_MOTIVO = "No partner availability: no viable bid within 36h of the first invite";

export function preencherTexto(
  modelo: string,
  valores: Record<string, string | null | undefined>,
  opcoes: { html?: boolean } = {},
): string {
  const html = opcoes.html ?? true;
  return modelo.replace(/\{\{(\w+)\}\}/g, (_, chave: string) => {
    const v = String(valores[chave] ?? "");
    return html ? escaparHtml(v) : v;
  });
}

function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
