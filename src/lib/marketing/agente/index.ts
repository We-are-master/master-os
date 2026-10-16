/**
 * O agente de marketing: a rotina de todo dia.
 *
 *   manhã   lê os "Stop" do WhatsApp no Zendesk; põe cada pessoa da base na
 *           lista certa da Resend pela posição do lead (lista.ts); garante as
 *           edições do clube e da sequência das agências criadas e agendadas
 *           (o Resend só agenda 30 dias à frente); manda o pedido de avaliação
 *           a quem fez job há 10 dias; e, se hoje abre um relâmpago, confere o
 *           código no site, agenda o e-mail e monta a fila do WhatsApp.
 *   tarde   manda o WhatsApp do relâmpago que está no ar.
 *
 * `MARKETING_AGENTE=on` liga. Desligado, as duas rotinas rodam em ensaio e só
 * contam: deploy nunca vira campanha por acidente.
 */

import { varrerRespostasDoZendesk } from "@/lib/marketing/zendesk-respostas";
import { relampagoDoDia, relampagoNoAr } from "./calendario";
import { ONDAS, montarB2B, nomeDaOnda } from "./b2b";
import { montarClube, type LinhaDoClube } from "./clube";
import { segmentoPeloNome } from "./resend";
import { NOME_DO_SEGMENTO, NOME_DO_SEGMENTO_SEMANAL, sincronizarLista, type ResultadoDaLista } from "./lista";
import { mandarAvaliacoes } from "./avaliacao";
import { abrirRelampago, voltaDoWhatsApp, type ResultadoDaAbertura, type ResultadoDoWhatsApp } from "./relampago";

export function agenteLigado(): boolean {
  return process.env.MARKETING_AGENTE?.trim().toLowerCase() === "on";
}

export type ResultadoDaManha = {
  ligado: boolean;
  ensaio: boolean;
  lista: ResultadoDaLista | { erro: string };
  clube: { criados: number; agendados: number; enviados: number; erros: string[]; proxima: LinhaDoClube | null };
  relampago: ResultadoDaAbertura | null;
  b2b: Array<{ onda: number; agendados: number; rascunhos: number; erros: string[] }>;
  avaliacoes: unknown;
  stops: unknown;
};

/**
 * A lista do clube saiu da Vercel (dono, 16/10/2026): sincronizar 1.000 contatos
 * por dia passa dos 300 s da função e a rotina morria antes da avaliação e do
 * relâmpago. Quem sincroniza agora é o fixfy-workers no Railway, às 7h30 de
 * Londres (`clube-lista`). `MARKETING_LISTA_NA_VERCEL=on` volta ao jeito antigo.
 */
export const listaNaVercel = () => ["1", "on", "true"].includes(process.env.MARKETING_LISTA_NA_VERCEL?.trim().toLowerCase() ?? "");

export async function rodarManha(opcoes: { aplicar: boolean; agora?: Date; sincronizarLista?: boolean }): Promise<ResultadoDaManha> {
  const agora = opcoes.agora ?? new Date();
  const res: ResultadoDaManha = {
    ligado: agenteLigado(), ensaio: !opcoes.aplicar, lista: { erro: "não rodou" },
    clube: { criados: 0, agendados: 0, enviados: 0, erros: [], proxima: null }, relampago: null, b2b: [], avaliacoes: null, stops: null,
  };

  // Stop primeiro: quem pediu para sair ontem não pode entrar na lista de hoje.
  res.stops = await varrerRespostasDoZendesk({ minutos: 26 * 60, aplicar: opcoes.aplicar }).catch((e) => ({ erro: String(e.message ?? e) }));

  let segmentos: { duas: string | null; semanal: string | null } = { duas: null, semanal: null };
  if (opcoes.sincronizarLista ?? listaNaVercel()) {
    try {
      const lista = await sincronizarLista({ aplicar: opcoes.aplicar, agora });
      res.lista = lista;
      segmentos = lista.segmentos;
    } catch (e) {
      res.lista = { erro: String((e as Error).message ?? e) };
    }
  } else {
    segmentos = {
      duas: await segmentoPeloNome(NOME_DO_SEGMENTO, false).catch(() => null),
      semanal: await segmentoPeloNome(NOME_DO_SEGMENTO_SEMANAL, false).catch(() => null),
    };
    res.lista = { erro: "sincronizada pelo fixfy-workers (clube-lista, 7h30 de Londres)" };
  }

  const linhas = await montarClube({ aplicar: opcoes.aplicar, agendar: true, segmentos, agora });
  for (const l of linhas) {
    if (l.estado === "criado") res.clube.criados++;
    if (l.estado === "enviado") res.clube.enviados++;
    if (l.detalhe) res.clube.erros.push(`${l.dia} ${l.key} (${l.lista}): ${l.detalhe}`);
  }
  res.clube.agendados = linhas.filter((l) => l.estado === "agendado").length;
  res.clube.proxima = linhas.find((l) => l.estado !== "enviado" && l.estado !== "passou") ?? null;

  // Agências: o Resend só agenda 30 dias à frente, então os rascunhos mais distantes ganham hora aqui, dia a dia.
  for (const onda of ONDAS) {
    try {
      const seg = await segmentoPeloNome(nomeDaOnda(onda.n), false);
      const ls = await montarB2B({ aplicar: opcoes.aplicar, agendar: true, onda: onda.n, inicio: onda.inicio, segmento: seg, agora });
      res.b2b.push({ onda: onda.n, agendados: ls.filter((l) => l.estado === "agendado").length, rascunhos: ls.filter((l) => l.estado === "rascunho" || l.estado === "criado").length, erros: ls.filter((l) => l.detalhe).map((l) => `${l.n}: ${l.detalhe}`) });
    } catch (e) {
      res.b2b.push({ onda: onda.n, agendados: 0, rascunhos: 0, erros: [String((e as Error).message ?? e)] });
    }
  }

  const hoje = relampagoDoDia(agora);
  if (hoje) res.relampago = await abrirRelampago(hoje, { aplicar: opcoes.aplicar, segmentos, agora }).catch((e) => ({ relampago: hoje.slug, codigo: hoje.codigo, ok: false, motivo: String(e.message ?? e) }));
  // Grupo E: cliente com job de 10 a 30 dias recebe o pedido de avaliação e indicação, uma vez.
  res.avaliacoes = await mandarAvaliacoes({ aplicar: opcoes.aplicar, agora }).catch((e) => ({ erro: String(e.message ?? e) }));
  return res;
}

export async function rodarTarde(opcoes: { aplicar: boolean }): Promise<ResultadoDoWhatsApp & { ligado: boolean }> {
  const r = await voltaDoWhatsApp(relampagoNoAr(), { aplicar: opcoes.aplicar });
  return { ligado: agenteLigado(), ...r };
}
