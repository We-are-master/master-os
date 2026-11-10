"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, X } from "lucide-react";

/**
 * O job card inteiro num modal grande, sem sair da tela (dono, 10/11/2026, Live
 * operations: "às vezes é só conferir algo, não precisa abrir outra tela").
 *
 * É o MESMO componente da página do job, então nada é duplicado: o que aparece
 * em /jobs/[id] aparece aqui, com rolagem. O ícone de expandir leva à página.
 * Cmd/Ctrl-clique no card continua abrindo em outra aba.
 */
const JobDetailClient = dynamic(
  () => import("@/app/(dashboard)/jobs/[id]/job-detail-client").then((m) => m.JobDetailClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    ),
  },
);

const EVENTO = "fixfy:job-peek";

/** Abre o job no modal. Quem chama não precisa saber onde o modal mora. */
export function abrirJobNoModal(jobId: string, reference?: string | null) {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { jobId, reference: reference ?? null } }));
}

/** Clique simples abre o modal; com Cmd/Ctrl/Shift ou botão do meio, o link segue normal. */
export function cliqueAbreModal(e: React.MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

/** Monte uma vez na tela que abre jobs no modal. */
export function JobPeekHost() {
  const [aberto, setAberto] = useState<{ jobId: string; reference: string | null } | null>(null);

  useEffect(() => {
    const abrir = (e: Event) => {
      const d = (e as CustomEvent<{ jobId: string; reference: string | null }>).detail;
      if (d?.jobId) setAberto(d);
    };
    window.addEventListener(EVENTO, abrir);
    return () => window.removeEventListener(EVENTO, abrir);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc fecha o modal do job só quando nenhum modal de dentro está aberto.
      if (e.key === "Escape" && !document.querySelector("[data-job-peek] [role='dialog']")) setAberto(null);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [aberto]);

  if (!aberto || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 backdrop-blur-[1px] sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setAberto(null);
      }}
    >
      <div
        data-job-peek
        role="document"
        className="flex h-full max-h-[94vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-2xl border border-border-light bg-surface shadow-2xl dark:border-[#2b313d]"
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border-light bg-card px-4 dark:border-[#2b313d]">
          <span className="font-mono text-[12px] font-semibold tracking-[0.02em] text-text-secondary">
            {aberto.reference ?? "Job"}
          </span>
          <div className="flex items-center gap-1">
            <Link
              href={`/jobs/${aberto.jobId}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
              title="Open full page"
              aria-label="Open full page"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => setAberto(null)}
              title="Close"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4">
          <JobDetailClient key={aberto.jobId} jobId={aberto.jobId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
