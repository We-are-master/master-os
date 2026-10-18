"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Endereço na lista de jobs (dono, 18/10/2026): uma linha só, a altura da linha
 * não muda. Quando o texto não cabe, passar o mouse mostra o endereço inteiro
 * num cartão flutuante por cima da célula (portal, então o overflow da tabela
 * não corta). Clicar no endereço copia (e não abre o job).
 */
export function AddressCell({ address }: { address: string | null | undefined }) {
  const texto = address?.trim() ?? "";
  const ref = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const abrir = useCallback(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const r = ref.current!.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 260), 360);
    const left = Math.min(r.left - 8, window.innerWidth - width - 12);
    setPos({ top: r.top - 6, left: Math.max(12, left), width });
  }, []);

  if (!texto) return <span className="text-text-tertiary">—</span>;

  return (
    <>
      <button
        ref={ref}
        type="button"
        title="Click to copy the address"
        onMouseEnter={abrir}
        onMouseLeave={() => setPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void navigator.clipboard.writeText(texto);
          toast.success("Address copied");
        }}
        className="group flex w-full min-w-0 items-center gap-1 rounded text-left text-[12px] text-text-secondary transition-colors hover:text-primary"
      >
        <span className="min-w-0 truncate">{texto}</span>
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />
      </button>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
              className="pointer-events-none rounded-lg border border-border-light bg-card px-2 py-1.5 text-[12px] leading-snug text-text-primary shadow-lg"
            >
              {texto}
              <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-text-tertiary">
                <Copy className="h-3 w-3" aria-hidden />
                Click to copy
              </span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
