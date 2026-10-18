"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Endereço na lista de jobs (dono, 18/10/2026): uma linha só, a altura da linha
 * não muda. Quando o texto não cabe, passar o mouse mostra o endereço inteiro
 * num cartão flutuante por cima da célula (portal, então o overflow da tabela
 * não corta). Se cabe, não aparece nada.
 */
export function AddressCell({ address }: { address: string | null | undefined }) {
  const texto = address?.trim() ?? "";
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const abrir = useCallback(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 260), 360);
    const left = Math.min(r.left - 8, window.innerWidth - width - 12);
    setPos({ top: r.top - 6, left: Math.max(12, left), width });
  }, []);

  if (!texto) return <span className="text-text-tertiary">—</span>;

  return (
    <>
      <p
        ref={ref}
        onMouseEnter={abrir}
        onMouseLeave={() => setPos(null)}
        className="m-0 min-w-0 truncate text-[12px] text-text-secondary"
      >
        {texto}
      </p>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
              className="pointer-events-none rounded-lg border border-border-light bg-card px-2 py-1.5 text-[12px] leading-snug text-text-primary shadow-lg"
            >
              {texto}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
