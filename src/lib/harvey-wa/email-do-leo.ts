/**
 * Os e-mails de acompanhamento ao cliente (cobrança de quote, régua de lead):
 * a moldura leve de pessoa para pessoa (emailPessoal, fixfy-shell.ts), assinada
 * "The Fixfy team" (handoff 20/10/2026: nome de pessoa só quando configurado e
 * monitorado; o padrão é a equipe).
 *
 * O comentário do Zendesk continua saindo com o autor do papel "autor_emails"
 * (responsavel-operacao.ts, editável em /agents/harvey): é quem recebe a resposta
 * na fila. O corpo não leva nome de pessoa; se o perfil desse autor no Zendesk
 * tiver assinatura, o Zendesk ainda a acrescenta embaixo (configuração de lá).
 * (O nome do arquivo ficou; as funções são neutras.)
 */

import { emailPessoal } from "@/lib/emails/fixfy-shell";
import { responsavel, type Responsavel } from "@/lib/responsavel-operacao";

/** Quem é o autor dos comentários de acompanhamento no Zendesk agora. */
export const autorDosEmails = (): Promise<Responsavel> => responsavel("autor_emails");

/** Um e-mail de acompanhamento: o assunto só vale fora de thread (Resend ou ticket novo). */
export type EmailDeAcompanhamento = {
  assunto: string;
  preheader: string;
  saudacao: string;
  paragrafos: string[];
  cta?: { label: string; url: string | null | undefined } | null;
};

/** HTML e texto puro do mesmo conteúdo. `zendesk` para comentário público. */
export function montarEmail(e: EmailDeAcompanhamento, zendesk = false): { html: string; text: string } {
  return emailPessoal({ preheader: e.preheader, saudacao: e.saudacao, paragrafos: e.paragrafos, cta: e.cta ?? null, zendesk });
}

/** O comentário público pronto para o PUT do ticket: autor do papel, corpo na moldura leve. */
export function comentarioDoEmail(e: EmailDeAcompanhamento, autorId: number) {
  return { public: true, author_id: autorId, html_body: montarEmail(e, true).html };
}

/** Remetente dos e-mails de acompanhamento pela Resend: a equipe, resposta no hello@. */
export const REMETENTE_DA_EQUIPE = "Fixfy <no-reply@getfixfy.com>";
