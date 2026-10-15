/**
 * E-mail automático ao cliente sai do Leo, com a assinatura dele (dono, 15/10/2026:
 * "email de chase poderia sair do Leo com a assinatura dele, bonitinho"). Vale para a
 * cobrança de quote e para a régua de lead por e-mail.
 *
 * Comentário criado pela API não ganha a assinatura do agente no Zendesk, então ela
 * vai no próprio corpo, em HTML, no mesmo formato da assinatura que o Leo tem lá.
 * O autor sai de HARVEY_EMAIL_AUTHOR_ID (padrão: o usuário do Leo).
 */

export const AUTOR_DOS_EMAILS = Number(process.env.HARVEY_EMAIL_AUTHOR_ID?.trim() || 6227542863391);

const ASSINATURA_HTML =
  '<p style="margin:16px 0 0"><strong>Leonardo Piovesan</strong> | Operations<br>' +
  "<em>Maintenance, handled. End to end.</em></p>" +
  '<p style="margin:8px 0 0"><a href="https://www.getfixfy.com/">Our Website</a> | <a href="https://www.getfixfy.com/platform">The Platform</a></p>';

export const ASSINATURA_TEXTO = "Leonardo Piovesan | Operations\nMaintenance, handled. End to end.\nhttps://www.getfixfy.com";

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto simples (parágrafos separados por linha em branco) em HTML, com a despedida e a assinatura do Leo. */
export function htmlDoLeo(texto: string, despedida = "Kind regards,"): string {
  const paragrafos = texto
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapar(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `${paragrafos}<p style="margin:0">${escapar(despedida)}<br>Leo</p>${ASSINATURA_HTML}`;
}

/** O comentário público pronto para o PUT do ticket: autor Leo, corpo em HTML. */
export function comentarioDoLeo(texto: string, despedida?: string) {
  return { public: true, author_id: AUTOR_DOS_EMAILS, html_body: htmlDoLeo(texto, despedida) };
}

/** Para e-mail fora do Zendesk (Resend): o mesmo fecho, em texto. */
export function textoDoLeo(texto: string, despedida = "Kind regards,"): string {
  return `${texto.trim()}\n\n${despedida}\nLeo\n\n${ASSINATURA_TEXTO}`;
}
