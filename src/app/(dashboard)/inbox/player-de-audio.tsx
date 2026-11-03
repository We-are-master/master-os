"use client";

/**
 * PLAYER DE ÁUDIO do Atendimento (founder 28/09: "experiência premium, estilo
 * WhatsApp"). No lugar do `<audio controls>` do navegador, que destoava do
 * resto: botão redondo, a ONDA do próprio áudio (lida do arquivo, uma vez, e
 * guardada), a parte tocada pintando a onda, arrastar na onda pra ir a um
 * ponto, o tempo e a velocidade 1× · 1,5× · 2×.
 *
 * - A onda só é calculada quando o player aparece na tela (a conversa pode ter
 *   dezenas de áudios; baixar todos de cara seria custo à toa).
 * - Um áudio tocando pausa o que estava tocando antes, como no WhatsApp.
 * - Sem conseguir ler o arquivo (formato, rede), a onda fica lisa e o resto
 *   funciona.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as EventoDePonteiro } from "react";
import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CHIP } from "./movimento";

/** Quantos fios a onda desenha. */
const FIOS = 42;
const EVENTO_TOCANDO = "fixfy-inbox-audio-tocando";
const VELOCIDADES = [1, 1.5, 2] as const;

type Lido = { picos: number[]; duracao: number };
const lidos = new Map<string, Promise<Lido | null>>();

/** Lê o arquivo e reduz a onda a `FIOS` níveis (RMS por fatia, normalizado). */
function lerOnda(src: string): Promise<Lido | null> {
  const guardado = lidos.get(src);
  if (guardado) return guardado;
  const p = (async () => {
    try {
      const r = await fetch(src);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      try {
        const audio = await ctx.decodeAudioData(buf);
        const dados = audio.getChannelData(0);
        const fatia = Math.max(1, Math.floor(dados.length / FIOS));
        const brutos: number[] = [];
        for (let i = 0; i < FIOS; i++) {
          let soma = 0;
          const ini = i * fatia;
          const fim = Math.min(dados.length, ini + fatia);
          for (let j = ini; j < fim; j += 16) soma += dados[j]! * dados[j]!;
          brutos.push(Math.sqrt(soma / Math.max(1, (fim - ini) / 16)));
        }
        const maior = Math.max(...brutos, 0.0001);
        return { picos: brutos.map((v) => Math.max(0.08, Math.sqrt(v / maior))), duracao: audio.duration };
      } finally {
        void ctx.close().catch(() => undefined);
      }
    } catch {
      return null;
    }
  })();
  lidos.set(src, p);
  return p;
}

/** Reamostra uma lista de níveis pra `n` fios (a prévia grava ~16 por segundo). */
function reamostrar(picos: number[], n: number): number[] {
  if (!picos.length) return Array<number>(n).fill(0.08);
  return Array.from({ length: n }, (_, i) => {
    const ini = Math.floor((i / n) * picos.length);
    const fim = Math.max(ini + 1, Math.floor(((i + 1) / n) * picos.length));
    let m = 0;
    for (let j = ini; j < fim; j++) m = Math.max(m, picos[j] ?? 0);
    return Math.max(0.08, m);
  });
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function PlayerDeAudio({
  src,
  picos: picosProntos,
  duracao: duracaoPronta,
  variante = "conversa",
}: {
  src: string;
  /** A onda já conhecida (a prévia da gravação). Sem ela, lê do arquivo. */
  picos?: number[];
  /** A duração já conhecida (a gravação sabe; o webm do navegador às vezes não diz). */
  duracao?: number;
  variante?: "conversa" | "previa";
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const ondaRef = useRef<HTMLDivElement>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  const [tocando, setTocando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [velocidade, setVelocidade] = useState<(typeof VELOCIDADES)[number]>(1);
  const [arrastando, setArrastando] = useState(false);
  const rafRef = useRef<number | null>(null);
  const id = useId();

  /* A onda do arquivo, quando o player aparece. */
  useEffect(() => {
    if (picosProntos) return;
    const el = raizRef.current;
    if (!el) return;
    let vivo = true;
    const ver = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        ver.disconnect();
        void lerOnda(src).then((l) => {
          if (vivo && l) setLido(l);
        });
      },
      { rootMargin: "200px" },
    );
    ver.observe(el);
    return () => {
      vivo = false;
      ver.disconnect();
    };
  }, [src, picosProntos]);

  const fios = useMemo(() => (picosProntos ? reamostrar(picosProntos, FIOS) : lido?.picos ?? null), [picosProntos, lido]);
  const duracao = duracaoPronta ?? lido?.duracao ?? 0;

  /* A duração que o próprio <audio> diz (o webm do navegador às vezes só sabe depois). */
  const [doAudio, setDoAudio] = useState(0);
  const dur = doAudio > 0 ? doAudio : duracao;
  const duracaoReal = useCallback(() => dur, [dur]);
  const lerDuracao = (a: HTMLAudioElement) => {
    if (Number.isFinite(a.duration) && a.duration > 0) setDoAudio(a.duration);
  };

  /* O progresso anda liso (rAF), não no passo do `timeupdate`. */
  useEffect(() => {
    if (!tocando) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const acompanhar = () => {
      const a = audioRef.current;
      const d = duracaoReal();
      if (a && d > 0) setProgresso(Math.min(1, a.currentTime / d));
      rafRef.current = requestAnimationFrame(acompanhar);
    };
    rafRef.current = requestAnimationFrame(acompanhar);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tocando, duracaoReal]);

  /* Um tocando por vez na janela. */
  useEffect(() => {
    const outro = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) audioRef.current?.pause();
    };
    window.addEventListener(EVENTO_TOCANDO, outro);
    return () => window.removeEventListener(EVENTO_TOCANDO, outro);
  }, [id]);

  async function alternar() {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (progresso >= 1) a.currentTime = 0;
    a.playbackRate = velocidade;
    window.dispatchEvent(new CustomEvent(EVENTO_TOCANDO, { detail: id }));
    try {
      await a.play();
    } catch {
      /* o navegador recusou (arquivo ruim): fica parado */
    }
  }

  function trocarVelocidade() {
    const i = VELOCIDADES.indexOf(velocidade);
    const nova = VELOCIDADES[(i + 1) % VELOCIDADES.length]!;
    setVelocidade(nova);
    if (audioRef.current) audioRef.current.playbackRate = nova;
  }

  function irPara(clientX: number) {
    const onda = ondaRef.current;
    const a = audioRef.current;
    const d = duracaoReal();
    if (!onda || !a || d <= 0) return;
    const r = onda.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    a.currentTime = f * d;
    setProgresso(f);
  }

  function apertarOnda(e: EventoDePonteiro<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setArrastando(true);
    irPara(e.clientX);
  }

  const tempo = tocando || progresso > 0 ? dur * progresso : dur;

  return (
    <div ref={raizRef} className={"pa" + (variante === "previa" ? " pa-previa" : "") + (tocando ? " pa-tocando" : "")}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => lerDuracao(e.currentTarget)}
        onDurationChange={(e) => lerDuracao(e.currentTarget)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setProgresso(1);
        }}
      />
      <button type="button" className="pa-play" onClick={() => void alternar()} aria-label={tocando ? "Pause audio" : "Play audio"}>
        {/* A troca de ícone do VOS: um sai encolhendo, o outro entra crescendo. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={tocando ? "pausa" : "play"} className="grid" {...CHIP}>
            {tocando ? <Pause size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
          </motion.span>
        </AnimatePresence>
      </button>
      <div
        ref={ondaRef}
        className={"pa-onda" + (arrastando ? " pa-arrastando" : "")}
        role="slider"
        tabIndex={0}
        aria-label="Audio position"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(dur * progresso)}
        onPointerDown={apertarOnda}
        onPointerMove={(e) => arrastando && irPara(e.clientX)}
        onPointerUp={() => setArrastando(false)}
        onPointerCancel={() => setArrastando(false)}
        onKeyDown={(e) => {
          const a = audioRef.current;
          if (!a) return;
          if (e.key === "ArrowRight") a.currentTime = Math.min(duracaoReal(), a.currentTime + 5);
          if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5);
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            void alternar();
          }
        }}
      >
        {(fios ?? Array<number>(FIOS).fill(0.08)).map((n, i) => (
          <i
            key={i}
            className={(i + 0.5) / FIOS <= progresso ? "on" : undefined}
            style={{ transform: `scaleY(${n})`, ["--i" as string]: i } as React.CSSProperties}
          />
        ))}
        {/* O trilho tem a largura da onda: andar a % DELE é andar a onda, só
            por transform. */}
        <span className="pa-trilho" style={{ transform: `translateX(${progresso * 100}%)` }} aria-hidden>
          <span className="pa-bola" />
        </span>
      </div>
      <span className="pa-tempo mono">{mmss(tempo)}</span>
      {variante === "conversa" ? (
        <button type="button" className="pa-vel" onClick={trocarVelocidade} aria-label={`Speed ${velocidade}×`}>
          {velocidade}×
        </button>
      ) : null}
    </div>
  );
}
