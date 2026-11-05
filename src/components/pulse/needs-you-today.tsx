"use client";

/**
 * Action required (dono, 05/11/2026): só o que pede ação hoje, e cada cartão já abre onde
 * a ação acontece.
 *
 *  - Final review: a lista dos jobs em final check, com o relatório (entrou, falta,
 *    aprovado). "Review" abre a revisão final do job, onde se completa o relatório e a
 *    Stefane envia à plataforma.
 *  - Overdue invoices: cada fatura vencida com a próxima cobrança no botão (1st, 2nd, 3rd,
 *    final, extra), conforme quantas já saíram. O e-mail é o mesmo da rodada diária.
 *  - Without a partner: cada job abre o Assign partner.
 *  - Scheduled: a agenda.
 *
 * Sem filtro de datas: é o estado de agora.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { pulseMoney } from "@/lib/pulse-money-display";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";

type JobLinha = {
  id: string;
  reference: string | null;
  title: string | null;
  client_name: string | null;
  partner_name: string | null;
  status: string;
  client_price: number | null;
  extras_amount: number | null;
  final_report_submitted: boolean | null;
  final_report_approved_at: string | null;
  report_1_uploaded: boolean | null;
};
type Vencida = { id: string; reference: string | null; clientName: string | null; jobReference: string | null; balance: number; dueDate: string; daysOverdue: number; stage: number; lastChaseAt: string | null; sent: boolean };
type Estado = { jobs: JobLinha[]; vencidas: Vencida[] | null };

const FINAL = 4;
/** O rótulo da próxima cobrança, pelo estágio que a fatura já tem. */
function proximaCobranca(stage: number): string {
  if (stage >= FINAL) return "Send extra chase";
  return ["Send 1st chase", "Send 2nd chase", "Send 3rd chase", "Send final chase"][stage] ?? "Send chase";
}
function jaSaiu(stage: number): string {
  if (stage <= 0) return "No chase sent yet";
  if (stage >= FINAL) return "Final chase sent";
  return `${["1st", "2nd", "3rd"][stage - 1]} chase sent`;
}
const valor = (j: JobLinha) => (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

function useEstado() {
  const [d, setD] = useState<Estado | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    void Promise.all([
      getSupabase()
        .from("jobs")
        .select("id, reference, title, client_name, partner_name, status, client_price, extras_amount, final_report_submitted, final_report_approved_at, report_1_uploaded")
        .in("status", ["final_check", "scheduled", "late", "in_progress", "unassigned", "auto_assigning"])
        .is("deleted_at", null)
        .limit(5000),
      fetch("/api/invoices/overdue")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as Promise<{ invoices: Vencida[] } | null>,
    ]).then(([jobs, vencidas]) => {
      if (vivo) setD({ jobs: (jobs.data ?? []) as JobLinha[], vencidas: vencidas?.invoices ?? null });
    });
    return () => {
      vivo = false;
    };
  }, [versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { d, recarregar };
}

function Linha({ referencia, nome, sub, direita }: { referencia: string; nome: string; sub: React.ReactNode; direita: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-xl border border-fx-line bg-card px-4 py-3 transition-colors hover:border-fx-line-strong">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[11px] font-semibold text-text-tertiary tabular-nums">{referencia}</span>
          <span className="truncate text-[14px] font-semibold text-text-primary">{nome}</span>
        </p>
        <p className="m-0 mt-1 truncate text-[12px] text-text-secondary tabular-nums">{sub}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">{direita}</div>
    </li>
  );
}

/** O miolo de todos os modais: uma linha de resumo e a lista com respiro. */
function Corpo({ resumo, vazio, children }: { resumo: React.ReactNode; vazio: string | null; children: React.ReactNode }) {
  return (
    <div className="px-5 pb-5 pt-4">
      {vazio ? (
        <p className="m-0 rounded-xl bg-fx-paper-2/60 px-4 py-8 text-center text-[13px] text-text-secondary">{vazio}</p>
      ) : (
        <>
          <p className="m-0 mb-3 text-[12px] text-text-secondary tabular-nums">{resumo}</p>
          <ul className="m-0 list-none space-y-2 p-0">{children}</ul>
        </>
      )}
    </div>
  );
}

function Selo({ tom, children }: { tom: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        tom === "ok" ? "bg-fx-green-50 text-fx-green" : tom === "warn" ? "bg-fx-coral-50 text-fx-coral-p" : "bg-fx-paper-2 text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}

function ModalFinalReview({ open, onClose, jobs }: { open: boolean; onClose: () => void; jobs: JobLinha[] }) {
  return (
    <Modal open={open} onClose={onClose} title="Final review" subtitle="Check the report, complete what is missing and send it. Stefane submits it to the platform from the review." size="lg">
      <Corpo
        vazio={jobs.length === 0 ? "Nothing waiting for final review." : null}
        resumo={`${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${pulseMoney(jobs.reduce((t, j) => t + valor(j), 0))} waiting to invoice`}
      >
          {jobs.map((j) => {
            const temRelatorio = Boolean(j.final_report_submitted || j.report_1_uploaded);
            return (
              <Linha
                key={j.id}
                referencia={j.reference ?? "Job"}
                nome={j.client_name ?? "Client"}
                sub={`${pulseMoney(valor(j))}${j.partner_name ? ` · ${j.partner_name}` : ""}${j.title ? ` · ${j.title}` : ""}`}
                direita={
                  <>
                    {j.final_report_approved_at ? <Selo tom="ok">Report approved</Selo> : temRelatorio ? <Selo tom="muted">Report in</Selo> : <Selo tom="warn">Report missing</Selo>}
                    <Link href={`/jobs/${j.id}?action=approve`} className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-[var(--line-2)] bg-card px-3 text-[12px] font-semibold text-text-primary hover:bg-surface-secondary">
                      {temRelatorio ? "Review" : "Complete report"}
                      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                    </Link>
                  </>
                }
              />
            );
          })}
      </Corpo>
    </Modal>
  );
}

function ModalVencidas({ open, onClose, vencidas, onEnviado }: { open: boolean; onClose: () => void; vencidas: Vencida[]; onEnviado: () => void }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const cobrar = async (f: Vencida) => {
    setEnviando(f.id);
    try {
      // Nunca enviada: primeiro a fatura, depois a cobrança.
      const r = f.sent
        ? await fetch(`/api/invoices/${f.id}/chase`, { method: "POST" })
        : await fetch("/api/invoices/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: f.id }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!r.ok) {
        toast.error(j.error ?? `Could not send (${r.status})`);
        return;
      }
      toast.success(f.sent ? `${proximaCobranca(f.stage).replace("Send ", "")} sent for ${f.reference ?? "the invoice"}` : `${f.reference ?? "Invoice"} sent to the client`);
      onEnviado();
    } finally {
      setEnviando(null);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Overdue invoices" subtitle="Each button sends the next email in the chase sequence, with the invoice PDF and the payment link." size="lg">
      <Corpo
        vazio={vencidas.length === 0 ? "No overdue invoices." : null}
        resumo={`${vencidas.length} invoice${vencidas.length === 1 ? "" : "s"} · ${pulseMoney(vencidas.reduce((t, f) => t + f.balance, 0))} overdue${vencidas.some((f) => !f.sent) ? ` · ${vencidas.filter((f) => !f.sent).length} never sent to the client` : ""}`}
      >
          {vencidas.map((f) => (
            <Linha
              key={f.id}
              referencia={f.reference ?? "Invoice"}
              nome={f.clientName ?? "Client"}
              sub={
                <>
                  <span className="font-semibold text-text-primary">{pulseMoney(f.balance)}</span> · {f.daysOverdue} day{f.daysOverdue === 1 ? "" : "s"} overdue
                </>
              }
              direita={
                <>
                {f.sent ? <Selo tom={f.stage >= FINAL ? "warn" : "muted"}>{`${jaSaiu(f.stage)}${f.lastChaseAt ? ` · ${dataCurta(f.lastChaseAt)}` : ""}`}</Selo> : <Selo tom="warn">Never sent</Selo>}
                <Button size="sm" variant="secondary" icon={<Send />} disabled={enviando !== null} onClick={() => void cobrar(f)}>
                  {enviando === f.id ? "Sending…" : f.sent ? proximaCobranca(f.stage) : "Send invoice"}
                </Button>
                </>
              }
            />
          ))}
      </Corpo>
    </Modal>
  );
}

function ModalSemParceiro({ open, onClose, jobs, onAssign }: { open: boolean; onClose: () => void; jobs: JobLinha[]; onAssign: (j: JobLinha) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Without a partner" subtitle="Jobs waiting for allocation." size="lg">
      <Corpo vazio={jobs.length === 0 ? "Every job has a partner." : null} resumo={`${jobs.length} job${jobs.length === 1 ? "" : "s"} waiting for a partner`}>
          {jobs.map((j) => (
            <Linha
              key={j.id}
              referencia={j.reference ?? "Job"}
              nome={j.client_name ?? "Client"}
              sub={`${pulseMoney(valor(j))}${j.title ? ` · ${j.title}` : ""}`}
              direita={
                <Button size="sm" variant="secondary" onClick={() => onAssign(j)}>
                  Assign partner
                </Button>
              }
            />
          ))}
      </Corpo>
    </Modal>
  );
}

export function NeedsYouToday() {
  const { d, recarregar } = useEstado();
  const [aberto, setAberto] = useState<"revisao" | "vencidas" | "parceiro" | null>(null);
  const [atribuir, setAtribuir] = useState<JobLinha | null>(null);

  const jobs = d?.jobs ?? [];
  const revisao = jobs.filter((j) => j.status === "final_check");
  const semParceiro = jobs.filter((j) => j.status === "unassigned" || j.status === "auto_assigning");
  const agendados = jobs.filter((j) => j.status === "scheduled" || j.status === "late").length;
  const emAndamento = jobs.filter((j) => j.status === "in_progress").length;
  const vencidas = d?.vencidas ?? [];
  const totalVencido = vencidas.reduce((t, f) => t + f.balance, 0);

  const itens: Array<{ chave: string; titulo: string; sub: string; alerta: boolean; abrir?: () => void; href?: string }> = d
    ? [
        { chave: "revisao", titulo: `${revisao.length} in final review`, sub: `${pulseMoney(revisao.reduce((t, j) => t + valor(j), 0))} waiting to invoice`, alerta: revisao.length > 0, abrir: () => setAberto("revisao") },
        { chave: "vencidas", titulo: `${vencidas.length} overdue invoice${vencidas.length === 1 ? "" : "s"}`, sub: `${pulseMoney(totalVencido)} to chase`, alerta: vencidas.length > 0, abrir: () => setAberto("vencidas") },
        { chave: "parceiro", titulo: `${semParceiro.length} without a partner`, sub: "Need assigning", alerta: semParceiro.length > 0, abrir: () => setAberto("parceiro") },
        { chave: "agenda", titulo: `${agendados} scheduled`, sub: `${emAndamento} in progress now`, alerta: false, href: "/schedule" },
      ]
    : [];

  const cartaoCls = (alerta: boolean) =>
    cn(
      "group min-w-0 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
      alerta ? "border-fx-coral/30 bg-fx-coral-50 hover:border-fx-coral/60" : "border-fx-line bg-card hover:border-fx-line-strong",
    );
  const conteudo = (i: (typeof itens)[number]) => (
    <>
      <p className={cn("m-0 flex items-center justify-between gap-2 text-[13px] font-semibold tabular-nums", i.alerta ? "text-fx-coral-p" : "text-text-primary")}>
        <span className="truncate">{i.titulo}</span>
        <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
      <p className="m-0 mt-0.5 truncate text-[12px] text-text-secondary tabular-nums">{i.sub}</p>
    </>
  );

  return (
    <section aria-label="Action required">
      <p className="mb-2 text-[12px] font-semibold text-text-secondary">Action required</p>
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {d
          ? itens.map((i) =>
              i.href ? (
                <Link key={i.chave} href={i.href} className={cartaoCls(i.alerta)}>
                  {conteudo(i)}
                </Link>
              ) : (
                <button key={i.chave} type="button" onClick={i.abrir} className={cartaoCls(i.alerta)}>
                  {conteudo(i)}
                </button>
              ),
            )
          : [0, 1, 2, 3].map((k) => <div key={k} className="h-[54px] animate-pulse rounded-xl bg-fx-paper-2/60" />)}
      </div>

      <ModalFinalReview open={aberto === "revisao"} onClose={() => setAberto(null)} jobs={revisao} />
      <ModalVencidas open={aberto === "vencidas"} onClose={() => setAberto(null)} vencidas={vencidas} onEnviado={recarregar} />
      <ModalSemParceiro
        open={aberto === "parceiro" && !atribuir}
        onClose={() => setAberto(null)}
        jobs={semParceiro}
        onAssign={(j) => setAtribuir(j)}
      />
      {atribuir ? (
        <AssignPartnerModal
          jobId={atribuir.id}
          jobReference={atribuir.reference ?? ""}
          isOpen
          onClose={() => setAtribuir(null)}
          onAssigned={() => {
            setAtribuir(null);
            recarregar();
          }}
        />
      ) : null}
    </section>
  );
}
