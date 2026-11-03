"use client";

/**
 * O GRAVADOR DE ÁUDIO do Atendimento, um motor só (founder 28/09: "mandar
 * áudio com experiência premium, estilo WhatsApp mesmo"). A tela cheia do
 * Atendimento e a gaveta tinham cada uma a própria cópia do MediaRecorder;
 * agora as duas usam isto.
 *
 * Fases: `parado` → `gravando` ⇄ `pausado` → (enviar | descartar) → `parado`.
 * - Gravar pede o microfone e começa (opus em ogg, com o webm de reserva: é o
 *   que o WhatsApp aceita).
 * - Pausar segura a gravação e monta a PRÉVIA (um arquivo com o que já foi
 *   gravado), pra ouvir antes de mandar; retomar continua no mesmo arquivo.
 * - A onda é a do microfone de verdade (RMS a cada ~60 ms): `niveis` são os
 *   últimos, pra onda que corre; `picos` é a gravação inteira, pra prévia.
 * - O tempo não conta as pausas.
 * - `modo`: `travado` (clicou no microfone, mãos livres) ou `segurando`
 *   (segura o botão: soltar envia, arrastar cancela ou trava).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type FaseDoGravador = "parado" | "pedindo" | "gravando" | "pausado";
export type ModoDoGravador = "travado" | "segurando";

/** Barras da onda que corre (as mais recentes). */
export const BARRAS_AO_VIVO = 44;
/** A cada quanto a onda ganha um fio novo. */
const PASSO_MS = 60;

const TIPOS = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

/**
 * O que muda a CADA QUADRO (tempo e onda) mora fora do estado do React: quem
 * usa o gravador é a tela inteira do Atendimento, e ela re-renderizaria 60
 * vezes por segundo. Só a faixa assina isto (`useSinalDoGravador`).
 */
export interface SinalDoGravador {
  ler: () => { segundos: number; niveis: number[] };
  assinar: (ouvinte: () => void) => () => void;
}

export interface GravadorDeAudio {
  fase: FaseDoGravador;
  modo: ModoDoGravador;
  /** Tempo e onda ao vivo (assine com `useSinalDoGravador`). */
  sinal: SinalDoGravador;
  /** Todos os níveis da gravação, pra a onda da prévia. */
  picos: number[];
  /** A prévia do que já foi gravado (só com a gravação pausada). */
  previa: string | null;
  iniciar: (modo?: ModoDoGravador) => Promise<boolean>;
  pausar: () => void;
  retomar: () => void;
  travar: () => void;
  /** Encerra e devolve o arquivo (null se não gravou nada). */
  concluir: () => Promise<File | null>;
  descartar: () => void;
}

export function useGravadorDeAudio(opcoes?: { onErro?: (mensagem: string) => void }): GravadorDeAudio {
  const [fase, setFase] = useState<FaseDoGravador>("parado");
  const [modo, setModo] = useState<ModoDoGravador>("travado");
  const [picos, setPicos] = useState<number[]>([]);
  /* O sinal: um valor imutável por quadro (o `useSyncExternalStore` compara
     por referência) e os ouvintes. */
  const vivoRef = useRef<{ segundos: number; niveis: number[] }>({ segundos: 0, niveis: Array<number>(BARRAS_AO_VIVO).fill(0) });
  const ouvintesRef = useRef(new Set<() => void>());
  const publicar = useCallback((parcial: Partial<{ segundos: number; niveis: number[] }>) => {
    vivoRef.current = { ...vivoRef.current, ...parcial };
    for (const o of ouvintesRef.current) o();
  }, []);
  const [sinal] = useState<SinalDoGravador>(() => ({
    ler: () => vivoRef.current,
    assinar: (o) => {
      ouvintesRef.current.add(o);
      return () => ouvintesRef.current.delete(o);
    },
  }));

  const [previa, setPrevia] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const picosRef = useRef<number[]>([]);
  const faseRef = useRef<FaseDoGravador>("parado");
  /* O relógio: soma do que já foi gravado + desde quando está gravando agora. */
  const acumuladoRef = useRef(0);
  const desdeRef = useRef<number | null>(null);
  const onErroRef = useRef(opcoes?.onErro);
  useEffect(() => {
    onErroRef.current = opcoes?.onErro;
  });

  const mudarFase = (f: FaseDoGravador) => {
    faseRef.current = f;
    setFase(f);
  };

  const soltarPrevia = useCallback(() => {
    setPrevia((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }, []);

  /** Solta o microfone, o analisador e o laço. Sempre pelo mesmo caminho. */
  const soltarTudo = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    recRef.current = null;
    desdeRef.current = null;
  }, []);

  useEffect(() => () => soltarTudo(), [soltarTudo]);

  const iniciar = useCallback(
    async (m: ModoDoGravador = "travado") => {
      if (faseRef.current !== "parado") return false;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        onErroRef.current?.("This browser cannot record audio");
        return false;
      }
      mudarFase("pedindo");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        mudarFase("parado");
        const nome = (err as { name?: string })?.name;
        onErroRef.current?.(
          nome === "NotAllowedError"
            ? "Microphone blocked. Allow it from the padlock in the address bar."
            : nome === "NotFoundError"
              ? "No microphone found on this computer."
              : "Could not access the microphone",
        );
        return false;
      }
      const tipo = TIPOS.find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacosRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pedacosRef.current.push(e.data);
      };
      streamRef.current = stream;
      recRef.current = rec;
      picosRef.current = [];
      setPicos([]);
      acumuladoRef.current = 0;
      publicar({ segundos: 0, niveis: Array<number>(BARRAS_AO_VIVO).fill(0) });
      soltarPrevia();
      setModo(m);

      /* O ANALISADOR: RMS de cada quadro, o maior de cada passo vira um fio. */
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        ctxRef.current = ctx;
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analisador);
        const dados = new Uint8Array(analisador.fftSize);
        let pico = 0;
        let ultimo = performance.now();
        const medir = (agora: number) => {
          if (faseRef.current === "gravando") {
            analisador.getByteTimeDomainData(dados);
            let soma = 0;
            for (const v of dados) {
              const d = (v - 128) / 128;
              soma += d * d;
            }
            pico = Math.max(pico, Math.sqrt(soma / dados.length));
            if (agora - ultimo >= PASSO_MS) {
              /* Curva de raiz: voz baixa ainda aparece, grito não gruda no teto. */
              const nivel = Math.min(1, Math.sqrt(Math.min(1, pico * 3.4)));
              picosRef.current.push(nivel);
              publicar({ niveis: [...vivoRef.current.niveis.slice(1), nivel] });
              pico = 0;
              ultimo = agora;
            }
            if (desdeRef.current !== null) {
              const s = acumuladoRef.current + (agora - desdeRef.current) / 1000;
              /* O relógio só publica quando muda o décimo (o resto é custo à toa). */
              if (Math.floor(s * 10) !== Math.floor(vivoRef.current.segundos * 10)) publicar({ segundos: s });
            }
          }
          rafRef.current = requestAnimationFrame(medir);
        };
        rafRef.current = requestAnimationFrame(medir);
      } catch {
        /* Sem Web Audio: a gravação segue, só a onda fica parada. */
      }

      rec.start(250);
      desdeRef.current = performance.now();
      mudarFase("gravando");
      return true;
    },
    [publicar, soltarPrevia],
  );

  const pausar = useCallback(() => {
    const rec = recRef.current;
    if (!rec || faseRef.current !== "gravando") return;
    rec.pause();
    if (desdeRef.current !== null) acumuladoRef.current += (performance.now() - desdeRef.current) / 1000;
    desdeRef.current = null;
    publicar({ segundos: acumuladoRef.current });
    setPicos([...picosRef.current]);
    setModo("travado");
    mudarFase("pausado");
    /* A PRÉVIA: o que foi gravado até aqui já é um arquivo tocável (o 1º
       pedaço leva o cabeçalho). Pede o pedaço pendente e monta. */
    const montar = () => {
      soltarPrevia();
      const blob = new Blob(pedacosRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) setPrevia(URL.createObjectURL(blob));
    };
    const antes = rec.ondataavailable;
    rec.ondataavailable = (e) => {
      antes?.call(rec, e);
      rec.ondataavailable = antes;
      montar();
    };
    try {
      rec.requestData();
    } catch {
      rec.ondataavailable = antes;
      montar();
    }
  }, [publicar, soltarPrevia]);

  const retomar = useCallback(() => {
    const rec = recRef.current;
    if (!rec || faseRef.current !== "pausado") return;
    soltarPrevia();
    rec.resume();
    desdeRef.current = performance.now();
    mudarFase("gravando");
  }, [soltarPrevia]);

  const travar = useCallback(() => setModo("travado"), []);

  const concluir = useCallback(async (): Promise<File | null> => {
    const rec = recRef.current;
    if (!rec) return null;
    const tipo = rec.mimeType || "audio/webm";
    const arquivo = await new Promise<File | null>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(pedacosRef.current, { type: tipo });
        const ext = tipo.includes("ogg") ? "ogg" : "webm";
        resolve(blob.size > 0 ? new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type }) : null);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
    soltarTudo();
    soltarPrevia();
    mudarFase("parado");
    return arquivo;
  }, [soltarPrevia, soltarTudo]);

  const descartar = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      rec.onstop = null;
      rec.ondataavailable = null;
      try {
        rec.stop();
      } catch {
        /* já parou */
      }
    }
    pedacosRef.current = [];
    soltarTudo();
    soltarPrevia();
    mudarFase("parado");
  }, [soltarPrevia, soltarTudo]);

  return { fase, modo, sinal, picos, previa, iniciar, pausar, retomar, travar, concluir, descartar };
}

/** Tempo e onda ao vivo do gravador, re-renderizando SÓ quem chama. */
export function useSinalDoGravador(sinal: SinalDoGravador): { segundos: number; niveis: number[] } {
  return useSyncExternalStore(sinal.assinar, sinal.ler, sinal.ler);
}
