/**
 * O clube na Resend: cada edição do calendário vira um broadcast.
 *
 * O broadcast é da Resend de ponta a ponta (lista, envio, descadastro, números
 * de abertura e clique), que é onde o dono acompanha o resultado. O OS só monta
 * e agenda. O nome do broadcast carrega o dia ("Fixfy Club · 2026-10-16 · ...")
 * e é ele que impede a duplicata: rodar de novo não cria a mesma edição duas
 * vezes.
 *
 * O nome da pessoa e o link de saída são variáveis da Resend, trocadas por
 * contato na hora do envio.
 */

import { AGENDA, type PecaDaAgenda } from "@/lib/email-sequences/agenda";
import { ofertaDaPeca } from "@/lib/email-sequences/render";
import { renderCampanha, type Bloco, type OfertaNoEmail } from "@/lib/emails/campanha-layout";
import { CLUBE, SITE, quandoSaiAEdicao, type EdicaoDoClube } from "./calendario";
import { agendarBroadcast, broadcasts, criarBroadcast, type BroadcastResend } from "./resend";

/** "Hi Sarah" quando a Resend tem o nome, "Hi there" quando não tem. */
export const NOME_DO_CONTATO = "{{{contact.first_name|there}}}";
export const LINK_DE_SAIDA = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/**
 * Marketing sai do subdomínio `news`, nunca do domínio que manda confirmação e
 * cobrança, e sempre como Fixfy Team. Padrão no código de propósito: não
 * depende de variável na Vercel.
 */
export function remetente(): { from: string; reply_to: string } {
  return {
    from: process.env.MARKETING_AGENTE_FROM?.trim() || "Fixfy Team <team@news.getfixfy.com>",
    reply_to: process.env.MARKETING_AGENTE_REPLY_TO?.trim() || "hello@getfixfy.com",
  };
}

export function htmlDoBroadcast(p: {
  preheader: string; etiqueta: string; titulo: string; blocos: Bloco[]; oferta?: OfertaNoEmail; cta: { texto: string; url: string };
}): string {
  return renderCampanha({
    ...p,
    nome: NOME_DO_CONTATO,
    // Depoimento só entra quando for de cliente de verdade. Os da agenda eram texto de exemplo.
    blocos: p.blocos.filter((b) => b.tipo !== "citacao"),
    unsubscribeUrl: LINK_DE_SAIDA,
  });
}

export function pecaDaEdicao(e: EdicaoDoClube): PecaDaAgenda {
  const peca = AGENDA.find((p) => p.key === e.key);
  if (!peca) throw new Error(`calendário aponta para a peça "${e.key}", que não existe na agenda`);
  return peca;
}

export function linkDaEdicao(peca: PecaDaAgenda): string {
  const q = new URLSearchParams({ utm_source: "email", utm_medium: "club", utm_campaign: `club_${peca.key}` });
  if (peca.cupom) q.set("promo", peca.cupom);
  return `${SITE}/?${q.toString()}`;
}

export function htmlDaEdicao(peca: PecaDaAgenda): string {
  return htmlDoBroadcast({
    preheader: peca.preheader,
    etiqueta: peca.etiqueta,
    titulo: peca.titulo,
    blocos: peca.blocos,
    oferta: ofertaDaPeca(peca),
    cta: { texto: peca.cta, url: linkDaEdicao(peca) },
  });
}

export const nomeDoBroadcast = (e: EdicaoDoClube) => `Fixfy Club · ${e.dia} · ${e.key}`;

export type LinhaDoClube = { dia: string; key: string; assunto: string; cupom: string | null; estado: "passou" | "falta criar" | "rascunho" | "agendado" | "enviado" | "criado" | "erro"; detalhe?: string };

/**
 * Cria os broadcasts que faltam e, com `agendar`, põe hora nos rascunhos.
 * Sem `aplicar` só conta. Edição cuja hora já passou não é criada nem enviada:
 * e-mail de terça não sai na quinta.
 */
export async function montarClube(opcoes: { aplicar: boolean; agendar: boolean; segmento: string | null; agora?: Date }): Promise<LinhaDoClube[]> {
  const agora = opcoes.agora ?? new Date();
  const existentes = new Map<string, BroadcastResend>();
  for (const b of await broadcasts()) if (b.name) existentes.set(b.name, b);
  const { from, reply_to } = remetente();
  const linhas: LinhaDoClube[] = [];

  for (const e of CLUBE) {
    const peca = pecaDaEdicao(e);
    const linha: LinhaDoClube = { dia: e.dia, key: e.key, assunto: peca.assunto, cupom: peca.cupom ?? null, estado: "falta criar" };
    linhas.push(linha);
    const quando = quandoSaiAEdicao(e);
    let b = existentes.get(nomeDoBroadcast(e)) ?? null;
    if (b) linha.estado = b.sent_at || b.status === "sent" ? "enviado" : b.scheduled_at || b.status === "queued" ? "agendado" : "rascunho";
    if (quando.getTime() <= agora.getTime() + 10 * 60 * 1000) {
      if (linha.estado === "falta criar" || linha.estado === "rascunho") linha.estado = "passou";
      continue;
    }
    if (!opcoes.aplicar || !opcoes.segmento) continue;
    try {
      if (!b) {
        const novo = await criarBroadcast({ segment_id: opcoes.segmento, from, reply_to, subject: peca.assunto, html: htmlDaEdicao(peca), name: nomeDoBroadcast(e) });
        b = { id: novo.id, name: nomeDoBroadcast(e), status: "draft", scheduled_at: null, sent_at: null };
        linha.estado = "criado";
      }
      if (opcoes.agendar && (linha.estado === "criado" || linha.estado === "rascunho")) {
        await agendarBroadcast(b.id, quando);
        linha.estado = "agendado";
      }
    } catch (err) {
      linha.detalhe = String((err as Error).message ?? err);
      if (linha.estado === "falta criar") linha.estado = "erro";
    }
  }
  return linhas;
}
