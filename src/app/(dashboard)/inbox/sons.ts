"use client";

/**
 * O som de mensagem que chega no 7983. Só na chegada (mensagem de entrada),
 * nunca no que a equipe manda. Os 10 sons são gerados pelo Web Audio, sem
 * arquivo: nada para baixar e nenhum direito autoral. A escolha é de cada
 * pessoa, no navegador dela (localStorage).
 */

import { useEffect } from "react";
import type { ConversaDaCaixa } from "./tipos";

type Nota = { f: number; em: number; dur: number; tipo?: OscillatorType; vol?: number; ate?: number };

export type Som = { id: string; nome: string; notas: Nota[] };

export const SONS: Som[] = [
  { id: "ping", nome: "Ping", notas: [{ f: 1320, em: 0, dur: 0.25, vol: 0.25 }] },
  { id: "chime", nome: "Chime", notas: [{ f: 880, em: 0, dur: 0.35 }, { f: 1320, em: 0.12, dur: 0.45 }] },
  { id: "pop", nome: "Pop", notas: [{ f: 520, em: 0, dur: 0.09, ate: 900, vol: 0.35 }] },
  { id: "drop", nome: "Drop", notas: [{ f: 1400, em: 0, dur: 0.22, ate: 420, vol: 0.3 }] },
  { id: "ding-dong", nome: "Ding dong", notas: [{ f: 988, em: 0, dur: 0.4 }, { f: 784, em: 0.28, dur: 0.6 }] },
  { id: "bubble", nome: "Bubble", notas: [{ f: 400, em: 0, dur: 0.08, ate: 800 }, { f: 600, em: 0.09, dur: 0.08, ate: 1100 }] },
  { id: "marimba", nome: "Marimba", notas: [{ f: 659, em: 0, dur: 0.18, tipo: "triangle", vol: 0.4 }, { f: 988, em: 0.1, dur: 0.22, tipo: "triangle", vol: 0.4 }] },
  { id: "bell", nome: "Bell", notas: [{ f: 1046, em: 0, dur: 0.9, vol: 0.22 }, { f: 2093, em: 0, dur: 0.5, vol: 0.08 }] },
  { id: "glass", nome: "Glass", notas: [{ f: 1760, em: 0, dur: 0.5, vol: 0.15 }, { f: 2637, em: 0.06, dur: 0.4, vol: 0.1 }] },
  { id: "rise", nome: "Rise", notas: [{ f: 523, em: 0, dur: 0.12 }, { f: 659, em: 0.1, dur: 0.12 }, { f: 784, em: 0.2, dur: 0.25 }] },
];

export const SEM_SOM = "off";
const CHAVE = "inbox:som";
export const SOM_PADRAO = "chime";
const EVENTO = "inbox:som-escolhido";

export function somEscolhido(): string {
  try {
    return localStorage.getItem(CHAVE) || SOM_PADRAO;
  } catch {
    return SOM_PADRAO;
  }
}

export function escolherSom(id: string) {
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* sem storage fica o padrão */
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** Para o seletor (useSyncExternalStore): avisa quando a escolha muda, nesta aba ou em outra. */
export function ouvirEscolha(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener("storage", avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener("storage", avisar);
  };
}

let ctx: AudioContext | null = null;
function contexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function tocarSom(id: string = somEscolhido()) {
  const som = SONS.find((s) => s.id === id);
  const ac = som ? contexto() : null;
  if (!som || !ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const n of som.notas) {
    const osc = ac.createOscillator();
    const ganho = ac.createGain();
    osc.type = n.tipo ?? "sine";
    osc.frequency.setValueAtTime(n.f, t0 + n.em);
    if (n.ate) osc.frequency.exponentialRampToValueAtTime(n.ate, t0 + n.em + n.dur);
    ganho.gain.setValueAtTime(0.0001, t0 + n.em);
    ganho.gain.exponentialRampToValueAtTime(n.vol ?? 0.3, t0 + n.em + 0.01);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + n.em + n.dur);
    osc.connect(ganho).connect(ac.destination);
    osc.start(t0 + n.em);
    osc.stop(t0 + n.em + n.dur + 0.05);
  }
}

/**
 * A última entrada que já foi ouvida, de módulo: a /inbox e o painel lateral
 * olham a mesma caixa, e a mesma mensagem não pode tocar duas vezes.
 */
let ouvidaAte: number | null = null;

/** Toca o som escolhido quando aparece mensagem de entrada mais nova que a última vista. */
export function useSomDeChegada(conversas: ConversaDaCaixa[] | null | undefined) {
  useEffect(() => {
    if (!conversas) return;
    let maior = 0;
    for (const c of conversas) {
      const t = c.ultimaEntradaEm ? Date.parse(c.ultimaEntradaEm) : 0;
      if (t > maior) maior = t;
    }
    // A primeira leitura só marca: abrir a tela não é mensagem chegando.
    if (ouvidaAte === null) {
      ouvidaAte = maior;
      return;
    }
    if (maior > ouvidaAte) {
      ouvidaAte = maior;
      const id = somEscolhido();
      if (id !== SEM_SOM) tocarSom(id);
    }
  }, [conversas]);

  // O navegador só libera áudio depois de um clique na página.
  useEffect(() => {
    const liberar = () => contexto();
    window.addEventListener("pointerdown", liberar, { once: true });
    return () => window.removeEventListener("pointerdown", liberar);
  }, []);
}
