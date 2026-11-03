"use client";

/**
 * Link de job da /inbox: o clique abre o job num modal (ver, remarcar, trocar
 * parceiro, ticket) sem sair da conversa; Cmd/Ctrl-clique segue abrindo a aba.
 * "Open job card" no modal leva ao job completo.
 */

import { useState, type ReactNode } from "react";
import { JobQuickModal } from "@/components/jobs/job-quick-modal";

export function LinkDeJob({ id, className, title, children }: { id: string; className?: string; title?: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <a
        href={`/jobs/${id}`}
        className={className}
        title={title}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          setAberto(true);
        }}
      >
        {children}
      </a>
      {aberto ? <JobQuickModal jobId={id} isOpen={aberto} onClose={() => setAberto(false)} size="lg" /> : null}
    </>
  );
}
