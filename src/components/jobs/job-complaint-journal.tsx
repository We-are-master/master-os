"use client";

/**
 * A reclamação como conversa (dono, 15/10/2026): o cliente à esquerda, o
 * parceiro à direita e o escritório no meio, em ordem de chegada, com a hora
 * de cada mensagem. Antes eram dois cartões soltos (o que o cliente disse e a
 * resposta do parceiro) e ninguém lia a história de uma vez.
 *
 * Formato journal: tabela com data e hora, mais nova em cima, recolhida.
 *
 * Fontes, todas já existentes: o job (texto da queixa e hora do hold), a
 * resposta do parceiro (/api/jobs/[id]/on-hold-submission) e o histórico do
 * job (mudanças de status e notas do escritório depois do hold).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Clock, Image as ImageIcon, Loader2, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuditLogs } from "@/services/audit";
import type { AuditLog, Job } from "@/types/database";

interface Submission {
  notes: string | null;
  submittedAt: string | null;
  partnerName: string | null;
  photos: { id: string; url: string | null }[];
  availableDates?: string[];
  remedy?: "revisit" | "discount" | null;
  offers?: Array<{ data: string; slot: "morning" | "afternoon" }>;
  discountGbp?: number | null;
}

type Who = "client" | "partner" | "office";

type Entry = {
  key: string;
  who: Who;
  at: string | null;
  author: string;
  body: ReactNode;
};

const SLOT: Record<string, string> = { morning: "Morning · 8am to 1pm", afternoon: "Afternoon · 1pm to 6pm" };

function dia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Europe/London" });
}

function hora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function espera(desde: string | null): string {
  if (!desde) return "";
  const ms = Date.now() - new Date(desde).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)} days`;
}

/** "(raised in ticket #51376)" sai do texto e vira link, para a frase do cliente ficar limpa. */
function separarTicket(texto: string): { texto: string; ticket: string | null } {
  const m = texto.match(/\s*\(raised in ticket #(\d+)\)\s*$/i);
  return m ? { texto: texto.slice(0, m.index).trim(), ticket: m[1] } : { texto, ticket: null };
}

const STATUS: Record<string, string> = {
  on_hold: "On hold",
  in_progress_phase1: "In progress",
  in_progress_phase2: "In progress",
  scheduled: "Scheduled",
  final_check: "Final checks",
  awaiting_payment: "Awaiting payment",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function JobComplaintJournal({ job, zendeskSubdomain }: { job: Job; zendeskSubdomain?: string | null }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [allOpen, setAllOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/jobs/${job.id}/on-hold-submission`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      getAuditLogs("job", job.id, 200).catch(() => [] as AuditLog[]),
    ]).then(([sub, audit]) => {
      if (cancelled) return;
      setSubmission((sub as { submission?: Submission } | null)?.submission ?? null);
      setLogs(audit as AuditLog[]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [job.id, job.on_hold_submission_at, job.status]);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const desde = job.on_hold_at ?? null;
    const bruto = job.on_hold_complaint_description?.trim() || job.on_hold_reason?.trim() || "No description was recorded.";
    // on_hold_reason antigo vem como "Complaint — texto": o prefixo é rótulo, não fala do cliente.
    const { texto, ticket } = separarTicket(bruto.replace(/^complaint\s*[—:-]\s*/i, ""));
    const ticketUrl = ticket && zendeskSubdomain ? `https://${zendeskSubdomain}.zendesk.com/agent/tickets/${ticket}` : null;

    out.push({
      key: "cliente",
      who: "client",
      at: desde,
      author: job.client_name?.trim() || "Client",
      body: (
        <>
          <p className="m-0 whitespace-pre-wrap">{texto}</p>
          {ticket ? (
            <p className="m-0 mt-1 text-[11px] text-text-tertiary">
              Raised in{" "}
              {ticketUrl ? (
                <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  ticket #{ticket}
                </a>
              ) : (
                `ticket #${ticket}`
              )}
            </p>
          ) : null}
        </>
      ),
    });

    out.push({
      key: "hold",
      who: "office",
      at: desde,
      author: "Fixfy",
      body: `Job put on hold. ${job.partner_name?.trim() || "The partner"} was asked to reply from the partner portal.`,
    });

    // O que o escritório fez depois do hold: mudança de status e notas da equipe.
    const t0 = desde ? new Date(desde).getTime() : 0;
    for (const l of logs) {
      const t = new Date(l.created_at).getTime();
      if (!Number.isFinite(t) || t <= t0 + 1000) continue;
      if (l.action === "status_changed" && l.new_value && l.new_value !== "on_hold") {
        out.push({
          key: l.id,
          who: "office",
          at: l.created_at,
          author: l.user_name?.trim() || "Fixfy",
          body: `Status moved to ${STATUS[l.new_value] ?? l.new_value.replace(/_/g, " ")}.`,
        });
      } else if (l.action === "note" && l.field_name === "internal_note" && l.new_value?.trim()) {
        out.push({ key: l.id, who: "office", at: l.created_at, author: l.user_name?.trim() || "Team", body: l.new_value.trim() });
      }
    }

    if (submission) {
      const fotos = submission.photos ?? [];
      out.push({
        key: "parceiro",
        who: "partner",
        at: submission.submittedAt,
        author: submission.partnerName?.trim() || job.partner_name?.trim() || "Partner",
        body: (
          <div className="space-y-2">
            {submission.remedy === "discount" ? (
              <p className="m-0 font-semibold">
                Offers a discount instead of going back
                {typeof submission.discountGbp === "number" ? ` · £${submission.discountGbp.toFixed(2)}` : ""}
              </p>
            ) : null}
            {submission.remedy === "revisit" ? (
              <div>
                <p className="m-0 font-semibold">Will go back. Offer the client one of these:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(submission.offers ?? []).map((o) => (
                    <span
                      key={`${o.data}-${o.slot}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px]"
                    >
                      <span className="font-medium tabular-nums">{dia(o.data)}</span>
                      <span className="text-text-tertiary">{SLOT[o.slot] ?? o.slot}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {submission.notes?.trim() ? <p className="m-0 whitespace-pre-wrap">{submission.notes.trim()}</p> : null}
            {!submission.remedy && (submission.availableDates?.length ?? 0) > 0 ? (
              <div>
                <p className="m-0 text-[11px] text-text-tertiary">Can go back on</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {submission.availableDates!.map((d) => (
                    <span key={d} className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium tabular-nums">
                      {dia(d)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {fotos.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                {fotos.map((p) =>
                  p.url ? (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="Partner photo" className="aspect-square w-full rounded-md border border-border-light object-cover" />
                    </a>
                  ) : (
                    <div
                      key={p.id}
                      className="flex aspect-square w-full items-center justify-center rounded-md border border-border-light bg-surface text-text-tertiary"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ),
      });
    }

    return out.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return ta - tb;
    });
  }, [job, logs, submission, zendeskSubdomain]);

  const aguardando = job.status === "on_hold" && !submission;
  // Journal (dono, 15/10/2026): tabela "Date and time | Message", mais nova em cima,
  // cada mensagem recolhida em 3 linhas; "Expand all entries" abre todas.
  const linhas = [...entries].reverse();

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="m-0 text-[14px] font-semibold text-text-primary">Journal entries</h3>
        {linhas.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setAllOpen((v) => !v);
              setOpenKeys(new Set());
            }}
            className="text-[12px] font-medium text-primary underline underline-offset-2 hover:no-underline"
          >
            {allOpen ? "Collapse all entries" : "Expand all entries"}
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="m-0 flex items-center gap-2 px-4 py-3 text-[12px] text-text-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the journal
        </p>
      ) : null}

      <table className="mt-2 w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="w-[150px] px-4 py-2 text-[12px] font-semibold text-text-primary">Date and time</th>
            <th className="px-4 py-2 text-[12px] font-semibold text-text-primary">Message</th>
          </tr>
        </thead>
        <tbody>
          {aguardando ? (
            <tr className="border-b border-border-light">
              <td className="px-4 py-2.5 align-top text-[12px] text-text-tertiary">Now</td>
              <td className="px-4 py-2.5 align-top text-text-tertiary">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Waiting on the partner{job.on_hold_at ? ` for ${espera(job.on_hold_at)}` : ""}. They reply from the partner portal, under Action required.
                </span>
              </td>
            </tr>
          ) : null}
          {linhas.map((e) => {
            const aberto = allOpen || openKeys.has(e.key);
            const Icone = e.who === "client" ? User : e.who === "partner" ? Wrench : Building2;
            return (
              <tr
                key={e.key}
                onClick={() =>
                  setOpenKeys((prev) => {
                    const n = new Set(prev);
                    if (n.has(e.key)) n.delete(e.key);
                    else n.add(e.key);
                    return n;
                  })
                }
                className="cursor-pointer border-b border-border-light align-top last:border-b-0 hover:bg-surface-hover/40"
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-[12px] tabular-nums text-text-secondary">{hora(e.at) || "Not recorded"}</td>
                <td className="px-4 py-2.5">
                  <p
                    className={cn(
                      "m-0 mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold",
                      e.who === "client" ? "text-[var(--bad,#dc2626)]" : e.who === "partner" ? "text-[var(--info,#2563eb)]" : "text-text-tertiary",
                    )}
                  >
                    <Icone className="h-3 w-3" />
                    {e.author}
                    <span className="font-normal text-text-tertiary">
                      · {e.who === "client" ? "Client" : e.who === "partner" ? "Partner" : "Fixfy"}
                    </span>
                  </p>
                  <div className={cn("text-text-primary leading-relaxed", !aberto && "line-clamp-3")}>{e.body}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
