/**
 * E-mail automático ao cliente sai do Leo, com a assinatura dele (dono, 15/10/2026:
 * "email de chase poderia sair do Leo com a assinatura dele, bonitinho"). Vale para a
 * cobrança de quote e para a régua de lead por e-mail.
 *
 * A assinatura mora no perfil do Leo no Zendesk, e o Zendesk a acrescenta também ao
 * comentário criado pela API: no teste de 15/10/2026 ela saiu duas vezes quando o corpo
 * também a trazia. Então o comentário leva só o texto e "Kind regards, Leo". O e-mail
 * que sai pelo Resend (fora do Zendesk) é que carrega a assinatura no corpo.
 * O autor sai de HARVEY_EMAIL_AUTHOR_ID (padrão: o usuário do Leo).
 */

export const AUTOR_DOS_EMAILS = Number(process.env.HARVEY_EMAIL_AUTHOR_ID?.trim() || 6227542863391);

const ASSINATURA_HTML =
  '<p style="margin:16px 0 0"><strong>Leonardo Piovesan</strong> | Operations<br>' +
  "<em>Maintenance, handled. End to end.</em></p>" +
  '<p style="margin:8px 0 0"><a href="https://www.getfixfy.com/">Our Website</a> | <a href="https://www.getfixfy.com/platform">The Platform</a></p>';

export const ASSINATURA_TEXTO = "Leonardo Piovesan | Operations\nMaintenance, handled. End to end.\nhttps://www.getfixfy.com";

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto simples (parágrafos separados por linha em branco) em HTML, com a despedida do Leo. `comAssinatura` só fora do Zendesk. */
export function htmlDoLeo(texto: string, despedida = "Kind regards,", comAssinatura = false): string {
  const paragrafos = texto
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapar(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `${paragrafos}<p style="margin:0">${escapar(despedida)}<br>Leo</p>${comAssinatura ? ASSINATURA_HTML : ""}`;
}

/** O comentário público pronto para o PUT do ticket: autor Leo, corpo em HTML; a assinatura o Zendesk põe. */
export function comentarioDoLeo(texto: string, despedida?: string) {
  return { public: true, author_id: AUTOR_DOS_EMAILS, html_body: htmlDoLeo(texto, despedida) };
}

/** Para e-mail fora do Zendesk (Resend): o mesmo fecho, em texto. */
export function textoDoLeo(texto: string, despedida = "Kind regards,"): string {
  return `${texto.trim()}\n\n${despedida}\nLeo\n\n${ASSINATURA_TEXTO}`;
}
