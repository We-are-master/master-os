/**
 * O agente de marketing: a rotina de todo dia.
 *
 *   manhã   sincroniza a lista da Resend com o OS (nos dois sentidos), garante
 *           que as edições do clube estão criadas e agendadas, lê os "Stop" do
 *           WhatsApp no Zendesk e, se hoje abre um relâmpago, confere o código
 *           no site, agenda o e-mail e monta a fila do WhatsApp.
 *   tarde   manda o WhatsApp do relâmpago que está no ar.
 *
 * `MARKETING_AGENTE=on` liga. Desligado, as duas rotinas rodam em ensaio e só
 * contam: deploy nunca vira campanha por acidente.
 */

import { varrerRespostasDoZendesk } from "@/lib/marketing/zendesk-respostas";
import { relampagoDoDia, relampagoNoAr } from "./calendario";
import { montarClube, type LinhaDoClube } from "./clube";
import { sincronizarLista, type ResultadoDaLista } from "./lista";
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
  stops: unknown;
};

export async function rodarManha(opcoes: { aplicar: boolean; agora?: Date }): Promise<ResultadoDaManha> {
  const agora = opcoes.agora ?? new Date();
  const res: ResultadoDaManha = {
    ligado: agenteLigado(), ensaio: !opcoes.aplicar, lista: { erro: "não rodou" },
    clube: { criados: 0, agendados: 0, enviados: 0, erros: [], proxima: null }, relampago: null, stops: null,
  };

  // Stop primeiro: quem pediu para sair ontem não pode entrar na lista de hoje.
  res.stops = await varrerRespostasDoZendesk({ minutos: 26 * 60, aplicar: opcoes.aplicar }).catch((e) => ({ erro: String(e.message ?? e) }));

  let segmento: string | null = null;
  try {
    const lista = await sincronizarLista({ aplicar: opcoes.aplicar, agora });
    res.lista = lista;
    segmento = lista.segmento;
  } catch (e) {
    res.lista = { erro: String((e as Error).message ?? e) };
  }

  const linhas = await montarClube({ aplicar: opcoes.aplicar, agendar: true, segmento, agora });
  for (const l of linhas) {
    if (l.estado === "criado") res.clube.criados++;
    if (l.estado === "enviado") res.clube.enviados++;
    if (l.detalhe) res.clube.erros.push(`${l.dia} ${l.key}: ${l.detalhe}`);
  }
  res.clube.agendados = linhas.filter((l) => l.estado === "agendado").length;
  res.clube.proxima = linhas.find((l) => l.estado !== "enviado" && l.estado !== "passou") ?? null;

  const hoje = relampagoDoDia(agora);
  if (hoje) res.relampago = await abrirRelampago(hoje, { aplicar: opcoes.aplicar, segmento, agora }).catch((e) => ({ relampago: hoje.slug, codigo: hoje.codigo, ok: false, motivo: String(e.message ?? e) }));
  return res;
}

export async function rodarTarde(opcoes: { aplicar: boolean }): Promise<ResultadoDoWhatsApp & { ligado: boolean }> {
  const r = await voltaDoWhatsApp(relampagoNoAr(), { aplicar: opcoes.aplicar });
  return { ligado: agenteLigado(), ...r };
}
