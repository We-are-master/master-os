/**
 * E-mail automático ao cliente sai de uma pessoa da equipe, com a assinatura dela
 * (dono, 15/10/2026: "email de chase poderia sair ... com a assinatura dele, bonitinho").
 * Vale para a cobrança de quote e para a régua de lead por e-mail.
 *
 * Quem assina é o papel "autor_emails" (responsavel-operacao.ts, editável em
 * /agents/harvey); padrão HARVEY_EMAIL_AUTHOR_ID e depois o usuário de sempre.
 *
 * A assinatura mora no perfil da pessoa no Zendesk, e o Zendesk a acrescenta também ao
 * comentário criado pela API: no teste de 15/10/2026 ela saiu duas vezes quando o corpo
 * também a trazia. Então o comentário leva só o texto e "Kind regards,". O e-mail
 * que sai pelo Resend (fora do Zendesk) é que carrega a assinatura no corpo.
 * (O nome do arquivo ficou; as funções são neutras.)
 */

import { responsavel, type Responsavel } from "@/lib/responsavel-operacao";

/** Quem assina os e-mails de chase agora. */
export const autorDosEmails = (): Promise<Responsavel> => responsavel("autor_emails");

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function assinaturaHtml(nome: string): string {
  return (
    `<p style="margin:16px 0 0"><strong>${escapar(nome)}</strong> | Operations<br>` +
    "<em>Maintenance, handled. End to end.</em></p>" +
    '<p style="margin:8px 0 0"><a href="https://www.getfixfy.com/">Our Website</a> | <a href="https://www.getfixfy.com/platform">The Platform</a></p>'
  );
}

export const assinaturaTexto = (nome: string) => `${nome} | Operations\nMaintenance, handled. End to end.\nhttps://www.getfixfy.com`;

/** Texto simples (parágrafos separados por linha em branco) em HTML, com a despedida. `assinante` só fora do Zendesk. */
export function htmlDoEmail(texto: string, despedida = "Kind regards,", assinante: string | null = null): string {
  const paragrafos = texto
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapar(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  // Só a despedida: o nome já está na assinatura logo abaixo (dono, 15/10/2026).
  return `${paragrafos}<p style="margin:0">${escapar(despedida)}</p>${assinante ? assinaturaHtml(assinante) : ""}`;
}

/** O comentário público pronto para o PUT do ticket: autor é quem assina, corpo em HTML; a assinatura o Zendesk põe. */
export function comentarioDoEmail(texto: string, autorId: number, despedida?: string) {
  return { public: true, author_id: autorId, html_body: htmlDoEmail(texto, despedida) };
}

/** Para e-mail fora do Zendesk (Resend): o mesmo fecho, em texto. */
export function textoDoEmail(texto: string, assinante: string, despedida = "Kind regards,"): string {
  return `${texto.trim()}\n\n${despedida}\n\n${assinaturaTexto(assinante)}`;
}
