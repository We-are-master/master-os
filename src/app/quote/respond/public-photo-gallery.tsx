"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIXFY_BORDER, FIXFY_MUTED, FIXFY_NAVY } from "./public-fixfy-shell";

/**
 * A galeria das fotos do site, no lugar do link cru.
 *
 * O email de Quote Request mostrava cada foto apontando para o arquivo no
 * storage: clicou, abriu UMA foto numa aba pelada, sem voltar, sem próxima —
 * a reclamação dos parceiros (27/08). Agora o email aponta para cá
 * (`#photos`), e aqui é grade de miniaturas + lightbox com anterior/próxima,
 * teclado e swipe, porque parceiro vê isso no telefone.
 */
export default function PublicPhotoGallery({ urls }: { urls: string[] }) {
  const [aberta, setAberta] = useState<number | null>(null);
  const toqueX = useRef<number | null>(null);
  const raiz = useRef<HTMLDivElement | null>(null);

  // Quem chegou pelo "#photos" do email veio VER as fotos, e a âncora nativa
  // não funciona: a seção só existe depois do fetch. Rola até aqui no mount.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#photos") {
      raiz.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const anterior = useCallback(
    () => setAberta((i) => (i == null ? null : (i + urls.length - 1) % urls.length)),
    [urls.length],
  );
  const proxima = useCallback(
    () => setAberta((i) => (i == null ? null : (i + 1) % urls.length)),
    [urls.length],
  );

  useEffect(() => {
    if (aberta == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberta(null);
      if (e.key === "ArrowLeft") anterior();
      if (e.key === "ArrowRight") proxima();
    };
    window.addEventListener("keydown", onKey);
    // O fundo não rola enquanto o lightbox está aberto.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [aberta, anterior, proxima]);

  if (urls.length === 0) return null;

  return (
    <div id="photos" ref={raiz} className="scroll-mt-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: FIXFY_MUTED }}>
        Site photos ({urls.length})
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {urls.map((u, i) => (
          <button
            key={`${u}-${i}`}
            type="button"
            onClick={() => setAberta(i)}
            className="aspect-square overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
            style={{ borderColor: FIXFY_BORDER }}
            aria-label={`Open site photo ${i + 1} of ${urls.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`Site photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>

      {aberta != null ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          role="dialog"
          aria-label="Photo gallery"
          onClick={() => setAberta(null)}
          onTouchStart={(e) => {
            toqueX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const inicio = toqueX.current;
            toqueX.current = null;
            const fim = e.changedTouches[0]?.clientX;
            if (inicio == null || fim == null) return;
            const delta = fim - inicio;
            if (Math.abs(delta) < 40) return;
            if (delta > 0) anterior();
            else proxima();
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-medium">
              {aberta + 1} / {urls.length}
            </span>
            <button
              type="button"
              onClick={() => setAberta(null)}
              className="rounded-md px-3 py-1 text-sm font-semibold"
              style={{ backgroundColor: FIXFY_NAVY }}
            >
              Close ✕
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urls[aberta]}
              alt={`Site photo ${aberta + 1}`}
              className="max-h-full max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            {urls.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    anterior();
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    proxima();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
