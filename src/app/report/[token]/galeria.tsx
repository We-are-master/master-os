"use client";

import { useCallback, useEffect, useState } from "react";
import type { GrupoDeFotos } from "@/lib/report-web/dados";

/**
 * As fotos do report por cômodo, em grade. Clique abre a foto inteira; setas e Esc
 * navegam e fecham. Miniatura com loading="lazy": um job de 100 fotos abre rápido
 * no celular e só baixa o que aparece na tela.
 */
export function Galeria({ grupos, id }: { grupos: GrupoDeFotos[]; id: string }) {
  const todas = grupos.flatMap((g) => g.fotos);
  const [aberta, setAberta] = useState<number | null>(null);

  const fechar = useCallback(() => setAberta(null), []);
  const andar = useCallback((d: number) => setAberta((i) => (i == null ? i : (i + d + todas.length) % todas.length)), [todas.length]);

  useEffect(() => {
    if (aberta == null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight") andar(1);
      if (e.key === "ArrowLeft") andar(-1);
    };
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tecla);
      document.body.style.overflow = "";
    };
  }, [aberta, andar, fechar]);

  let indice = 0;
  return (
    <div className="space-y-8">
      {grupos.map((g) => (
        <section key={`${id}-${g.rotulo}`} aria-label={g.rotulo}>
          <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-[#1E1B4B]">
            {g.rotulo}
            <span className="text-xs font-normal text-[#6B6E7B]">{g.fotos.length} photo{g.fotos.length === 1 ? "" : "s"}</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {g.fotos.map((f) => {
              const i = indice++;
              return (
                <button
                  key={f.src}
                  type="button"
                  onClick={() => setAberta(i)}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-[#F2F0FA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
                  aria-label={`Open photo ${i + 1} of ${todas.length}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.src} alt={g.rotulo} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {aberta != null && todas[aberta] ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={fechar}>
          <div className="flex items-center justify-between px-4 py-3 text-sm text-white/80">
            <span>
              {todas[aberta].rotulo} · {aberta + 1} / {todas.length}
            </span>
            <button type="button" onClick={fechar} className="rounded px-3 py-1 text-white hover:bg-white/10" aria-label="Close">
              Close
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={todas[aberta].src} alt={todas[aberta].rotulo ?? "Photo"} className="max-h-full max-w-full object-contain" />
            <button type="button" onClick={() => andar(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-4 py-3 text-2xl text-white hover:bg-white/20" aria-label="Previous photo">
              ‹
            </button>
            <button type="button" onClick={() => andar(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-4 py-3 text-2xl text-white hover:bg-white/20" aria-label="Next photo">
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
