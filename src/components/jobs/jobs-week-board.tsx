"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Job } from "@/types/database";
import { cn } from "@/lib/utils";
import { addDaysYmd, ukTodayYmd } from "@/lib/uk-schedule-range";
import { jobScheduleYmd } from "@/lib/schedule-calendar";
import { scheduleJobStatusColorClasses } from "@/lib/schedule-job-type-style";
import { jobStatusLabel } from "@/lib/job-status-ui";

/**
 * Board da semana no Jobs (dono, 17/10/2026): uma coluna por dia, de segunda a domingo,
 * como o board do Live operations, mas com os jobs que a página já filtrou (aba, parceiro,
 * conta, busca, reclamação). A semana é a janela de data da página: setas trocam a janela.
 */

const UK = "Europe/London";
const DIAS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function horaUk(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: UK }).format(d);
}

function janela(job: Job): string | null {
  const a = horaUk(job.scheduled_start_at);
  const b = horaUk((job as { scheduled_end_at?: string | null }).scheduled_end_at);
  if (a && b) return `${a}–${b}`;
  return a;
}

function rotuloDoDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function rotuloDaSemana(segunda: string): string {
  return `${rotuloDoDia(segunda)} – ${rotuloDoDia(addDaysYmd(segunda, 6))}`;
}

type Props = {
  jobs: Job[];
  /** Segunda-feira da semana mostrada (YYYY-MM-DD, Londres). */
  weekStartYmd: string;
  loading?: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onOpenJob: (job: Job) => void;
};

export function JobsWeekBoard({ jobs, weekStartYmd, loading, onPrevWeek, onNextWeek, onThisWeek, onOpenJob }: Props) {
  const hoje = ukTodayYmd(new Date());
  const dias = useMemo(() => DIAS.map((_, i) => addDaysYmd(weekStartYmd, i)), [weekStartYmd]);

  const porDia = useMemo(() => {
    const m = new Map<string, Job[]>();
    const semData: Job[] = [];
    for (const j of jobs) {
      const p = jobScheduleYmd(j);
      const ymd = p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
      if (!ymd) {
        semData.push(j);
        continue;
      }
      if (!dias.includes(ymd)) continue;
      const lista = m.get(ymd) ?? [];
      lista.push(j);
      m.set(ymd, lista);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => String(a.scheduled_start_at ?? "").localeCompare(String(b.scheduled_start_at ?? "")));
    }
    return { m, semData };
  }, [jobs, dias]);

  const totalSemana = dias.reduce((s, d) => s + (porDia.m.get(d)?.length ?? 0), 0);
  const ehEstaSemana = dias.includes(hoje);

  const cartao = (j: Job) => {
    const hora = janela(j);
    const parceiro = j.partner_name?.trim();
    return (
      <button
        key={j.id}
        type="button"
        onClick={() => onOpenJob(j)}
        className="w-full rounded-lg border border-border bg-card p-2 text-left shadow-sm transition-colors hover:border-border-strong"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-1">
          <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-text-primary">{j.reference}</span>
          {hora ? <span className="whitespace-nowrap text-[10px] tabular-nums text-text-tertiary">{hora}</span> : null}
        </div>
        <p className="m-0 mt-0.5 line-clamp-1 text-[12px] font-medium text-text-primary">{j.client_name || "No client"}</p>
        <p className="m-0 line-clamp-1 text-[11px] text-text-secondary">{j.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
          <span className={cn("truncate text-[10px]", parceiro ? "text-text-secondary" : "font-medium text-red-600")}>
            {parceiro || "Unassigned"}
          </span>
          <span className={cn("shrink-0 rounded border px-1 py-px text-[9px] font-medium", scheduleJobStatusColorClasses(j.status))}>
            {jobStatusLabel(j.status)}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrevWeek} aria-label="Previous week" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[120px] text-center text-[13px] font-semibold tabular-nums text-text-primary">{rotuloDaSemana(weekStartYmd)}</span>
          <button type="button" onClick={onNextWeek} aria-label="Next week" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover">
            <ChevronRight className="h-4 w-4" />
          </button>
          {!ehEstaSemana ? (
            <button type="button" onClick={onThisWeek} className="ml-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover">
              This week
            </button>
          ) : null}
        </div>
        <span className="text-[11px] text-text-tertiary">
          {loading ? "Loading…" : `${totalSemana} job${totalSemana === 1 ? "" : "s"} this week`}
          {porDia.semData.length ? ` · ${porDia.semData.length} with no date` : ""}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] gap-2 p-2" style={{ gridTemplateColumns: `repeat(${porDia.semData.length ? 8 : 7}, minmax(0, 1fr))` }}>
          {dias.map((d, i) => {
            const lista = porDia.m.get(d) ?? [];
            const eHoje = d === hoje;
            return (
              <div key={d} className={cn("flex min-h-[420px] flex-col rounded-lg p-1.5", eHoje ? "bg-[#FFF1EB]" : "bg-surface-secondary")}>
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <span className={cn("text-[12px] font-semibold", eHoje ? "text-[#ED4B00]" : "text-text-primary")}>
                    {DIAS[i]} <span className="font-normal text-text-tertiary">{rotuloDoDia(d)}</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-text-tertiary">{lista.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">{lista.map(cartao)}</div>
              </div>
            );
          })}
          {porDia.semData.length ? (
            <div className="flex min-h-[420px] flex-col rounded-lg bg-surface-secondary p-1.5">
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className="text-[12px] font-semibold text-text-primary">No date</span>
                <span className="text-[11px] tabular-nums text-text-tertiary">{porDia.semData.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">{porDia.semData.map(cartao)}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
