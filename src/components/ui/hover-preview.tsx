"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Hover card for dense lists: wraps a cell and, after a short pause, floats a
 * preview next to it. Portal + fixed positioning so table overflow never clips
 * it. Mouse-only by design — touch has no hover, and tap already opens the row.
 *
 * O card aceita mouse: sair da célula dá um respiro curto antes de fechar, e
 * entrar no card cancela o fechamento — dá pra clicar em ações dentro dele
 * (abrir o job, copiar telefone) sem o preview sumir no caminho.
 */
export function HoverPreview({
  content,
  children,
  openDelayMs = 350,
  className,
}: {
  /** Card body. Pass null/undefined to disable the preview entirely. */
  content: ReactNode;
  children: ReactNode;
  openDelayMs?: number;
  className?: string;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setPos(null);
  }, []);

  /** Fechar com atraso: a ponte célula → card não pode derrubar o preview. */
  const scheduleHide = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setPos(null), 160);
  }, []);

  const cancelHide = useCallback(() => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const show = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cardWidth = 360;
    const margin = 12;
    // To the right of the cell when it fits, else to the left, clamped to viewport.
    let left = r.right + margin;
    if (left + cardWidth > window.innerWidth - margin) {
      left = Math.max(margin, r.left - cardWidth - margin);
    }
    const top = Math.min(Math.max(margin, r.top), window.innerHeight - margin - 200);
    setPos({ top, left });
  }, []);

  const onEnter = useCallback(() => {
    if (content == null) return;
    cancelHide();
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(show, openDelayMs);
  }, [content, openDelayMs, show, cancelHide]);

  useEffect(() => {
    if (!pos) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos, hide]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  return (
    <div ref={anchorRef} onMouseEnter={onEnter} onMouseLeave={scheduleHide} className={className}>
      {children}
      {pos && content != null && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[90] w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-3.5 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
              style={{ top: pos.top, left: pos.left }}
              role="tooltip"
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
