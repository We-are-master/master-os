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
import { renderCampanha } from "@/lib/emails/campanha-layout";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { SITE } from "./calendario";
import { remetente } from "./clube";
import { publicoComPosicao } from "./lista";
import { clientesComReclamacaoRecente } from "@/lib/feedback/reclamacao";

const CAMPANHA = "review_referral";
const LINK_DO_GOOGLE = "https://share.google/xs9HzIccBF88TgZoj";
const DIA_MS = 24 * 60 * 60 * 1000;

export const ASSUNTO_DA_AVALIACAO = "How did we do?";

export function htmlDaAvaliacao(nome: string | undefined, saida: string): string {
  return renderCampanha({
    preheader: "Two minutes to tell us, and £20 off for a friend.",
    etiqueta: "Thank you",
    titulo: "Thank you for booking with Fixfy",
    nome,
    blocos: [
      { tipo: "texto", html: "We hope everything was done the way you wanted. If anything was missed, reply to this email within 14 days of the job and we will come back to put it right." },
      { tipo: "lista", titulo: "If you were happy, two things help us more than anything", itens: [
        "A short Google review, so the next person knows what to expect",
        "Passing us on: a friend who books with the code <strong>REFER20</strong> gets £20 off any booking of £100 or more",
      ] },
    ],
    oferta: { codigo: "REFER20", valor: "£20 off", sobre: "for a friend, on bookings of £100 or more", validade: "31 March" },
    cta: { texto: "Leave a review", url: LINK_DO_GOOGLE },
    unsubscribeUrl: saida,
    notaDoRodape: `Book again any time at <a href="${SITE}" style="color:inherit;">getfixfy.com</a>.`,
  });
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
          html: htmlDaAvaliacao(a.nome === "there" ? undefined : a.nome, unsubscribeUrl(a.email as string)),
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
