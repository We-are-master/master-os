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

import { ofertaDaPeca } from "@/lib/email-sequences/render";
import { ASSINATURA_DO_VICTOR, renderCampanha, type Bloco, type OfertaNoEmail } from "@/lib/emails/campanha-layout";
import { pecaDoClube, type PecaDoClube } from "./clube-servicos";
import { CLUBE, SITE, quandoSaiAEdicao, type EdicaoDoClube } from "./calendario";
import { agendarBroadcast, broadcasts, criarBroadcast, type BroadcastResend } from "./resend";

/** "Hi Sarah" quando a Resend tem o nome, "Hi there" quando não tem. */
export const NOME_DO_CONTATO = "{{{contact.first_name|there}}}";
export const LINK_DE_SAIDA = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/**
 * Marketing sai do subdomínio `news`, nunca do domínio que manda confirmação e
 * cobrança, e no nome do Victor desde 15/10/2026. Padrão no código de propósito: não
 * depende de variável na Vercel.
 */
export function remetente(): { from: string; reply_to: string } {
  return {
    // Voz do Victor (dono, 15/10/2026): sai no nome dele e a resposta cai na caixa dele.
    from: process.env.MARKETING_AGENTE_FROM?.trim() || "Victor Braz at Fixfy <victor@news.getfixfy.com>",
    reply_to: process.env.MARKETING_AGENTE_REPLY_TO?.trim() || "victor@getfixfy.com",
  };
}

export function htmlDoBroadcast(p: {
  preheader: string; etiqueta: string; titulo: string; blocos: Bloco[]; oferta?: OfertaNoEmail; cta: { texto: string; url: string };
  selo?: string;
}): string {
  return renderCampanha({
    selo: "Fixfy Club",
    assinatura: ASSINATURA_DO_VICTOR,
    ...p,
    nome: NOME_DO_CONTATO,
    // Depoimento só entra quando for de cliente de verdade. Os da agenda eram texto de exemplo.
    blocos: p.blocos.filter((b) => b.tipo !== "citacao"),
    unsubscribeUrl: LINK_DE_SAIDA,
  });
}

export function pecaDaEdicao(e: EdicaoDoClube): PecaDoClube {
  return pecaDoClube(e.key);
}

export function linkDaEdicao(peca: PecaDoClube): string {
  const q = new URLSearchParams(peca.preset);
  for (const [k, v] of Object.entries({ utm_source: "email", utm_medium: "club", utm_campaign: `club_${peca.key}` })) q.set(k, v);
  if (peca.cupom) q.set("promo", peca.cupom);
  return `${SITE}/?${q.toString()}`;
}

export function htmlDaEdicao(peca: PecaDoClube): string {
  return htmlDoBroadcast({
    preheader: peca.preheader,
    etiqueta: peca.etiqueta,
    titulo: peca.titulo,
    blocos: peca.blocos,
    oferta: ofertaDaPeca(peca),
    cta: { texto: peca.cta, url: linkDaEdicao(peca) },
  });
}

export const nomeDoBroadcast = (e: EdicaoDoClube, lista: "duas" | "semanal" = "duas") =>
  `${lista === "duas" ? "Fixfy Club" : "Fixfy Club Weekly"} · ${e.dia} · ${e.key}`;

/** A lista semanal (lead antigo) recebe só a edição de terça. */
export const vaiParaSemanal = (e: EdicaoDoClube) => new Date(`${e.dia}T12:00:00Z`).getUTCDay() === 2;

export type LinhaDoClube = { dia: string; key: string; lista: "duas" | "semanal"; assunto: string; cupom: string | null; estado: "passou" | "falta criar" | "rascunho" | "agendado" | "enviado" | "criado" | "erro"; detalhe?: string };

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Cria os broadcasts que faltam nas duas listas e, com `agendar`, põe a hora.
 * O Resend só agenda até 30 dias à frente: o que passa disso fica em rascunho
 * e ganha hora numa volta seguinte (a rotina da manhã roda isto todo dia).
 * Edição cuja hora já passou não é criada nem enviada.
 */
export async function montarClube(opcoes: { aplicar: boolean; agendar: boolean; segmentos: { duas: string | null; semanal: string | null }; agora?: Date }): Promise<LinhaDoClube[]> {
  const agora = opcoes.agora ?? new Date();
  const existentes = new Map<string, BroadcastResend>();
  for (const b of await broadcasts()) if (b.name) existentes.set(b.name, b);
  const { from, reply_to } = remetente();
  const linhas: LinhaDoClube[] = [];

  for (const e of CLUBE) {
    const peca = pecaDaEdicao(e);
    const quando = quandoSaiAEdicao(e);
    for (const lista of ["duas", "semanal"] as const) {
      if (lista === "semanal" && !vaiParaSemanal(e)) continue;
      const segmento = opcoes.segmentos[lista];
      const nome = nomeDoBroadcast(e, lista);
      const linha: LinhaDoClube = { dia: e.dia, key: e.key, lista, assunto: peca.assunto, cupom: peca.cupom ?? null, estado: "falta criar" };
      linhas.push(linha);
      let b = existentes.get(nome) ?? null;
      if (b) linha.estado = b.sent_at || b.status === "sent" ? "enviado" : b.scheduled_at || b.status === "queued" || b.status === "scheduled" ? "agendado" : "rascunho";
      if (quando.getTime() <= agora.getTime() + 10 * 60 * 1000) {
        if (linha.estado === "falta criar" || linha.estado === "rascunho") linha.estado = "passou";
        continue;
      }
      if (!opcoes.aplicar || !segmento) continue;
      try {
        if (!b) {
          const novo = await criarBroadcast({ segment_id: segmento, from, reply_to, subject: peca.assunto, html: htmlDaEdicao(peca), name: nome });
          b = { id: novo.id, name: nome, status: "draft", scheduled_at: null, sent_at: null };
          linha.estado = "criado";
        }
        const cabe = quando.getTime() - agora.getTime() < 29 * DIA_MS;
        if (opcoes.agendar && cabe && (linha.estado === "criado" || linha.estado === "rascunho")) {
          await agendarBroadcast(b.id, quando);
          linha.estado = "agendado";
        }
      } catch (err) {
        const msg = String((err as Error).message ?? err);
        // Lista ainda vazia (a semanal antes de a rampa chegar nela): não é
        // falha, o rascunho espera e ganha hora na volta em que houver contato.
        if (/has no contacts/i.test(msg)) continue;
        linha.detalhe = msg;
        if (linha.estado === "falta criar") linha.estado = "erro";
      }
    }
  }
  return linhas;
}
