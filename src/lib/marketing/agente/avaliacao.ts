/**
 * Grupo E do clube B2C: cliente com job feito há até 30 dias.
 *
 * Esse cliente não recebe oferta (acabou de pagar). Recebe UM e-mail, a
 * partir do 10º dia depois do job: como foi, a avaliação no Google e o código
 * de indicação. Depois dos 30 dias ele vira grupo F e entra no clube.
 *
 * Sai um por pessoa, pelo Resend, no remetente do clube. A trava contra
 * repetição é o toque em `marketing_touches` (campanha `review_referral`).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { emailDeMarketing, ofertaAtiva, remetente } from "./clube";
import { publicoComPosicao } from "./lista";
import { clientesComReclamacaoRecente } from "@/lib/feedback/reclamacao";

const CAMPANHA = "review_referral";
const LINK_DO_GOOGLE = "https://share.google/xs9HzIccBF88TgZoj";
const DIA_MS = 24 * 60 * 60 * 1000;
/** O cupom de indicação. Código, valor, mínimo e validade saem de `marketing/cupons.ts`. */
const CUPOM_DE_INDICACAO = "REFER20";

// Copy aprovada em 20/10/2026 (docs/copy/fixfy-client-copy.json, id 40).
export const ASSUNTO_DA_AVALIACAO = "How was your experience with Fixfy?";

/**
 * O e-mail de avaliação + indicação, na moldura única com rodapé de marketing.
 *
 * Sem prazo novo de garantia ou reclamação (saiu o "reply within 14 days"). A
 * indicação é secundária e só aparece com o cupom vivo na configuração; sem
 * ele, o e-mail é só o pedido de avaliação.
 */
export function emailDaAvaliacao(nome: string | null | undefined, saida: string, agora: Date = new Date()): { assunto: string; html: string; texto: string } {
  const oferta = ofertaAtiva(CUPOM_DE_INDICACAO, agora);
  const indicacao = oferta
    ? [
        `Know someone with a job on their list? They can use ${oferta.codigo} for ${oferta.desconto} off an eligible booking${oferta.minimo ? ` of ${oferta.minimo} or more` : ""}. The offer is valid until ${oferta.validade}.`,
        "Thank you for passing us on.",
      ]
    : [];
  const { html, text } = emailDeMarketing({
    preheader: oferta ? "We’d love your feedback, and there’s an offer to share with a friend." : "We’d love to hear how it went.",
    estado: { texto: "Thank you", cor: "navy" },
    titulo: "We’d love to hear how it went",
    primeiroNome: nome,
    paragrafos: [
      "Thank you again for choosing Fixfy. We hope you’re pleased with the work.",
      "If you have a moment, a short review would mean a great deal to us and help other customers decide who to book. If anything needs our attention, please reply and let us know.",
      ...indicacao,
    ],
    cta: { label: "Leave a review", url: LINK_DO_GOOGLE },
    descadastroUrl: saida,
  });
  return { assunto: ASSUNTO_DA_AVALIACAO, html, texto: text };
}

export function htmlDaAvaliacao(nome: string | undefined, saida: string, agora?: Date): string {
  return emailDaAvaliacao(nome, saida, agora).html;
}

export async function mandarAvaliacoes(opcoes: { aplicar: boolean; max?: number; agora?: Date }): Promise<{ elegiveis: number; enviados: number; erros: string[] }> {
  const agora = opcoes.agora ?? new Date();
  const res = { elegiveis: 0, enviados: 0, erros: [] as string[] };
  const alvos = (await publicoComPosicao(agora)).filter(
    (a) => a.email && a.posicao === "E" && a.ultimoJob && agora.getTime() - a.ultimoJob.getTime() >= 10 * DIA_MS,
  );
  const sb = createServiceClient();
  const { data: ja } = await sb.from("marketing_touches").select("client_id").eq("campaign", CAMPANHA).limit(5000);
  const feitos = new Set((ja ?? []).map((t) => t.client_id));
  /**
   * Quem reclamou não recebe "leave a review" (14/10/2026). O WhatsApp de
   * feedback do dia 1 (`feedback/pos-job.ts`) pergunta "was everything done?";
   * se a resposta virou reclamação no OS, este e-mail do dia 10 não sai. Os
   * dois ficam em dias diferentes de propósito: um pega o problema a tempo de
   * consertar, o outro pede a avaliação pública a quem ficou satisfeito.
   */
  const comReclamacao = await clientesComReclamacaoRecente(
    sb,
    alvos.map((a) => a.clientId),
    new Date(agora.getTime() - 60 * DIA_MS).toISOString(),
  );
  const fila = alvos.filter((a) => !feitos.has(a.clientId) && !comReclamacao.has(a.clientId));
  res.elegiveis = fila.length;
  if (!opcoes.aplicar) return res;

  const { from, reply_to } = remetente();
  for (const a of fila.slice(0, opcoes.max ?? 40)) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, reply_to, to: [a.email], subject: ASSUNTO_DA_AVALIACAO,
          ...(() => {
            const e = emailDaAvaliacao(a.nome === "there" ? undefined : a.nome, unsubscribeUrl(a.email as string), agora);
            return { html: e.html, text: e.texto };
          })(),
          tags: [{ name: "campanha", value: CAMPANHA }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const corpo = (await r.json()) as { id?: string; message?: string };
      if (!r.ok) throw new Error(corpo.message ?? `Resend ${r.status}`);
      await sb.from("marketing_touches").insert({ email: a.email, client_id: a.clientId, campaign: CAMPANHA, channel: "email", segment: "b2c", subject: ASSUNTO_DA_AVALIACAO, provider_id: corpo.id ?? null, sent_at: new Date().toISOString() });
      res.enviados++;
    } catch (e) {
      res.erros.push(String((e as Error).message ?? e));
      if (res.erros.length >= 3) break;
    }
  }
  return res;
}
