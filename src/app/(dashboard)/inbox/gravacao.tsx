"use client";

/**
 * A GRAVAÇÃO DE ÁUDIO no composer do Atendimento (tela cheia e gaveta), no
 * estilo do WhatsApp (founder 28/09: "experiência premium, com um motion
 * bonito"). Duas peças, que conversam pelo `useGravadorDeAudio`:
 *
 * `FaixaDeGravacao`: a faixa que cola em cima do campo (a posição que o
 * founder aprovou em 23/09).
 *   - gravando: lixeira · ● tempo · a onda do microfone correndo · pausar · enviar;
 *   - segurando o microfone: ● tempo · onda · "‹ Deslize para cancelar", que
 *     acompanha o dedo e apaga conforme chega no limite;
 *   - pausado: lixeira · a PRÉVIA (ouvir o que gravou, com a onda inteira) ·
 *     continuar gravando · enviar;
 *   - descartar: a onda escoa pra dentro da lixeira, a tampa fecha, a faixa sai.
 *
 * `BotaoDoMicrofone`: clicar grava de mãos livres; SEGURAR grava enquanto
 * segura (soltar envia), arrastar pra esquerda cancela e pra cima trava (o
 * cadeado sobe acima do botão), como no celular.
 *
 * Movimento só por transform e opacidade, nos tokens do VOS Movimento; no
 * reduzido, só esmaece.
 */
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as EventoDePonteiro } from "react";
import { AnimatePresence, motion as m, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronUp, Lock, Mic, Pause, Send } from "lucide-react";
import { CHIP, flutuante } from "./movimento";
import { PlayerDeAudio } from "./player-de-audio";
import { BARRAS_AO_VIVO, useSinalDoGravador, type GravadorDeAudio } from "./gravador";

/** Quanto arrastar pra esquerda cancela, e pra cima trava (px). */
const LIMITE_CANCELAR = 120;
const LIMITE_TRAVAR = 72;
/** Segurar mais que isto é "segurar pra gravar"; menos, é clique. */
const SEGURAR_MS = 220;

const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** A onda que corre: o mais novo entra pela direita, o velho apaga à esquerda. */
function OndaAoVivo({ niveis }: { niveis: number[] }) {
  return (
    <div className="gv-onda" aria-hidden>
      {niveis.map((n, i) => (
        <i
          key={i}
          style={{
            transform: `scaleY(${Math.max(0.1, n)})`,
            opacity: Math.min(1, 0.2 + (i / BARRAS_AO_VIVO) * 1.4),
          }}
        />
      ))}
    </div>
  );
}

/** Tempo e onda, re-renderizando só este pedaço a cada quadro. */
function AoVivo({ gravador, pausado }: { gravador: GravadorDeAudio; pausado: boolean }) {
  const { segundos, niveis } = useSinalDoGravador(gravador.sinal);
  return (
    <>
      <span className={"gv-ponto" + (pausado ? " gv-ponto-pausado" : "")} aria-hidden />
      <span className="gv-tempo mono">{mmss(segundos)}</span>
      {!pausado ? <OndaAoVivo niveis={niveis} /> : null}
    </>
  );
}

function SegundosDaGravacao({ gravador }: { gravador: GravadorDeAudio }) {
  return useSinalDoGravador(gravador.sinal).segundos;
}

export function FaixaDeGravacao({
  gravador,
  onEnviar,
  arrasteRef,
}: {
  gravador: GravadorDeAudio;
  onEnviar: () => void;
  /** O elemento que recebe `--gv-arraste` do botão do microfone (modo segurando). */
  arrasteRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  const reduzido = useReducedMotion();
  const [descartando, setDescartando] = useState(false);
  const { fase, modo, previa, picos } = gravador;
  const pausado = fase === "pausado";
  const segurando = modo === "segurando" && fase === "gravando";

  /* DESCARTAR com a lixeira: a onda escoa, a tampa abre e fecha, e só então o
     gravador solta tudo (a faixa sai pelo `Recolher` de quem a monta). */
  function descartar() {
    if (descartando) return;
    if (reduzido) {
      gravador.descartar();
      return;
    }
    setDescartando(true);
    window.setTimeout(() => {
      gravador.descartar();
      setDescartando(false);
      /* O mesmo tempo da tampa no CSS (lg + md). */
    }, 480);
  }

  return (
    <div
      ref={arrasteRef}
      className={"gv" + (segurando ? " gv-segurando" : "") + (descartando ? " gv-descartando" : "")}
      role="status"
      aria-label={pausado ? "Recording paused" : "Recording audio"}
    >
      {!segurando ? (
        <button type="button" className="gv-lixeira" onClick={descartar} aria-label={"Discard recording"} title={"Discard"}>
          <span className="gv-tampa" aria-hidden>
            <svg viewBox="0 0 16 5" width="14" height="5">
              <path d="M1 4h14M6 1.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <svg className="gv-cesto" viewBox="0 0 16 12" width="14" height="11" aria-hidden>
            <path d="M3 1l1 10h8l1-10" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      ) : null}

      <div className="gv-meio">
        <AnimatePresence mode="popLayout" initial={false}>
          {pausado && previa ? (
            <m.div key="previa" className="gv-previa" {...CHIP}>
              <PlayerDeAudio src={previa} picos={picos} variante="previa" />
            </m.div>
          ) : (
            <m.div key="vivo" className="gv-vivo" {...CHIP}>
              <AoVivo gravador={gravador} pausado={pausado} />
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {segurando ? (
        <span className="gv-deslize" aria-hidden>
          <ChevronLeft size={14} />
          {"Slide to cancel"}
        </span>
      ) : (
        <>
          <button
            type="button"
            className={"gv-acao" + (pausado ? " gv-retomar" : "")}
            onClick={() => (pausado ? gravador.retomar() : gravador.pausar())}
            aria-label={pausado ? "Keep recording" : "Pause and listen"}
            title={pausado ? "Keep recording" : "Pause and listen"}
          >
            {pausado ? <Mic size={14} aria-hidden /> : <Pause size={14} fill="currentColor" aria-hidden />}
          </button>
          <button type="button" className="gv-enviar" onClick={onEnviar} aria-label={"Send voice note"} title={"Send"}>
            <Send size={14} aria-hidden />
          </button>
        </>
      )}
      {/* Só pra leitor de tela saber quanto já gravou ao pausar. */}
      {pausado ? (
        <span className="sr-only">
          {"Recorded"}: <SegundosDaGravacao gravador={gravador} />s
        </span>
      ) : null}
    </div>
  );
}

/**
 * O botão do microfone. Clique: grava de mãos livres (ou envia, se já está
 * gravando). Segurar: grava enquanto segura; soltar envia; arrastar pra
 * esquerda cancela; pra cima trava.
 */
export function BotaoDoMicrofone({
  gravador,
  onEnviar,
  arrasteRef,
  disabled,
  className = "attach",
}: {
  gravador: GravadorDeAudio;
  onEnviar: () => void;
  arrasteRef?: MutableRefObject<HTMLDivElement | null>;
  disabled?: boolean;
  className?: string;
}) {
  const [subida, setSubida] = useState(0);
  const gestoRef = useRef<{ x: number; y: number; timer: number; segurando: boolean; acabou: boolean } | null>(null);
  const gravadorRef = useRef(gravador);
  useEffect(() => {
    gravadorRef.current = gravador;
  });
  const segurando = gravador.modo === "segurando" && gravador.fase === "gravando";

  useEffect(() => () => {
    if (gestoRef.current) window.clearTimeout(gestoRef.current.timer);
  }, []);

  function pintarArraste(dx: number) {
    const el = arrasteRef?.current;
    if (el) el.style.setProperty("--gv-arraste", String(Math.min(0, dx)));
  }

  function apertar(e: EventoDePonteiro<HTMLButtonElement>) {
    if (disabled || e.button !== 0 || gravador.fase !== "parado") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = { x: e.clientX, y: e.clientY, timer: 0, segurando: false, acabou: false };
    g.timer = window.setTimeout(() => {
      g.segurando = true;
      void gravadorRef.current.iniciar("segurando");
    }, SEGURAR_MS);
    gestoRef.current = g;
  }

  function mover(e: EventoDePonteiro<HTMLButtonElement>) {
    const g = gestoRef.current;
    if (!g || !g.segurando || g.acabou) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    pintarArraste(dx);
    setSubida(Math.max(0, Math.min(1, -dy / LIMITE_TRAVAR)));
    if (dx <= -LIMITE_CANCELAR) {
      g.acabou = true;
      pintarArraste(0);
      setSubida(0);
      gravadorRef.current.descartar();
    } else if (dy <= -LIMITE_TRAVAR) {
      g.acabou = true;
      pintarArraste(0);
      setSubida(0);
      gravadorRef.current.travar();
    }
  }

  function soltar() {
    const g = gestoRef.current;
    gestoRef.current = null;
    pintarArraste(0);
    setSubida(0);
    if (!g) return;
    window.clearTimeout(g.timer);
    if (g.acabou) return;
    /* Soltou segurando: envia. Soltou antes do tempo: foi um clique. */
    if (g.segurando) onEnviar();
    else void gravadorRef.current.iniciar("travado");
  }

  function clicar(e: React.MouseEvent<HTMLButtonElement>) {
    /* Já gravando (mãos livres ou pausado): o microfone vira "enviar". */
    if (gravador.fase === "gravando" || gravador.fase === "pausado") {
      onEnviar();
      return;
    }
    /* Pelo teclado (Enter, Espaço) não há ponteiro: o clique começa a gravar. */
    if (e.detail === 0 && gravador.fase === "parado") void gravador.iniciar("travado");
  }

  const ativo = gravador.fase === "gravando" || gravador.fase === "pausado";

  return (
    <span className="gv-mic-lugar">
      <AnimatePresence>
        {segurando ? (
          <m.span key="cadeado" className="gv-cadeado" {...flutuante("top")} aria-hidden>
            <Lock size={14} />
            <span className="gv-cadeado-seta" style={{ transform: `translateY(${-subida * 6}px)`, opacity: 1 - subida * 0.6 }}>
              <ChevronUp size={12} />
            </span>
          </m.span>
        ) : null}
      </AnimatePresence>
      <button
        type="button"
        className={className + " gv-mic" + (ativo ? " gv-mic-ativo" : "") + (segurando ? " gv-mic-segurando" : "")}
        onPointerDown={apertar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onClick={clicar}
        disabled={disabled}
        aria-label={ativo ? "Send voice note" : "Record a voice note"}
        title={ativo ? "Send voice note" : "Record a voice note · hold to talk"}
      >
        {ativo && !segurando ? <Send size={15} aria-hidden /> : <Mic size={16} aria-hidden />}
      </button>
    </span>
  );
}
