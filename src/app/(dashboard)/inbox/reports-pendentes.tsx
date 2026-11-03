"use client";

/**
 * Reports em falta do parceiro: a lista com o link do formulário de cada job e o
 * pedido pronto para o WhatsApp. O pedido vai para a caixa de mensagem da
 * conversa; quem envia é a pessoa, depois de ler.
 */

import { useEffect, useState } from "react";
import { Copy, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LinkDeJob } from "./link-de-job";

type JobComLink = { id: string; ref: string; titulo: string | null; data: string | null; url: string };

/** O Composer ouve este evento e põe o texto na caixa da conversa aberta. */
export const EVENTO_RASCUNHO = "inbox:rascunho";
export const porNoComposer = (contato: string, texto: string) =>
  window.dispatchEvent(new CustomEvent(EVENTO_RASCUNHO, { detail: { contato, texto } }));

const diaCurto = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;

export function ReportsPendentes({
  aberto,
  onFechar,
  parceiroId,
  contato,
  nome,
  jobs,
}: {
  aberto: boolean;
  onFechar: () => void;
  parceiroId: string;
  contato: string;
  nome: string;
  jobs: { id: string; ref: string }[];
}) {
  const [lista, setLista] = useState<JobComLink[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // A lista do painel é recriada a cada render; os ids em texto seguram o efeito.
  const ids = jobs.map((j) => j.id).join(",");

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    void (async () => {
      try {
        const r = await fetch("/api/inbox/report-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parceiroId, jobIds: ids.split(",") }),
        });
        const j = (await r.json().catch(() => ({}))) as { jobs?: JobComLink[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? "Could not load the report links");
        if (!cancelado) setLista(j.jobs ?? []);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Could not load the report links");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [aberto, parceiroId, ids]);

  const pedido = (l: JobComLink[]) => {
    const primeiro = nome.trim().split(/\s+/)[0] || "there";
    const linhas = l.map((j) => `${j.ref}${diaCurto(j.data) ? ` (${diaCurto(j.data)})` : ""}: ${j.url}`).join("\n");
    return `Hi ${primeiro}, we are still missing the report${l.length > 1 ? "s" : ""} for ${l.length > 1 ? "these jobs" : "this job"}:\n\n${linhas}\n\nCould you fill ${l.length > 1 ? "them" : "it"} in today, please? Photos of the finished work are needed. Thank you.`;
  };

  return (
    <Modal open={aberto} onClose={onFechar} title="Missing reports" subtitle={`${jobs.length} job${jobs.length === 1 ? "" : "s"} without a report`} size="md">
      <div className="space-y-3 p-4">
        {erro ? (
          <p className="py-6 text-center text-sm text-text-tertiary">{erro}</p>
        ) : !lista ? (
          <p className="py-6 text-center text-sm text-text-tertiary">Loading…</p>
        ) : !lista.length ? (
          <p className="py-6 text-center text-sm text-text-tertiary">All reports submitted.</p>
        ) : (
          <>
            <ul className="divide-y divide-border-light rounded-xl border border-border-light">
              {lista.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <LinkDeJob id={j.id} className="text-[13.5px] font-semibold text-text-primary hover:underline">
                      {j.ref}
                    </LinkDeJob>
                    <p className="truncate text-[12px] text-text-tertiary">{[diaCurto(j.data), j.titulo].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button
                    type="button"
                    title="Copy the report link"
                    onClick={() => void navigator.clipboard?.writeText(j.url).then(() => toast.success(`${j.ref} report link copied`))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-text-secondary hover:bg-surface-secondary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <p className="mr-auto text-[11.5px] text-text-tertiary">Goes into the message box. Nothing is sent until you press send.</p>
              <Button
                size="sm"
                icon={<MessageSquareText className="h-3.5 w-3.5" />}
                onClick={() => {
                  porNoComposer(contato, pedido(lista));
                  onFechar();
                }}
              >
                Request on WhatsApp
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
