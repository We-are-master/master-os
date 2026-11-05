"use client";

/**
 * Live actions (dono, 05/11/2026): o que acabou de acontecer na operação, em tempo real.
 * Job novo, parceiro alocado, reclamação, pagamento, fatura e cobrança, cada um com a hora
 * exata (Londres) e quem fez: a pessoa, ou "Bot" quando foi automação. Atualiza sozinho:
 * escuta jobs e audit_logs pelo realtime do Supabase e, de reserva, busca a cada 20s.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, CircleDollarSign, FilePlus2, FileText, Mail, Send, UserCheck, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/fx/primitives";
import { getSupabase } from "@/services/base";
import { PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS, PULSE_FORECAST_PAIR_CARD_CLASS } from "@/lib/pulse-layout";
import type { AcaoAoVivo, TipoAcao } from "@/lib/pulse-live-actions";

const TIPO: Record<TipoAcao, { icone: React.ReactNode; cor: string }> = {
  job_created: { icone: <FilePlus2 className="h-3.5 w-3.5" />, cor: "text-fx-blue" },
  assigned: { icone: <UserCheck className="h-3.5 w-3.5" />, cor: "text-fx-navy" },
  status: { icone: <CheckCircle2 className="h-3.5 w-3.5" />, cor: "text-text-tertiary" },
  complaint: { icone: <AlertTriangle className="h-3.5 w-3.5" />, cor: "text-fx-red" },
  payment: { icone: <CircleDollarSign className="h-3.5 w-3.5" />, cor: "text-fx-green" },
  invoice_sent: { icone: <Mail className="h-3.5 w-3.5" />, cor: "text-fx-blue" },
  chase: { icone: <Send className="h-3.5 w-3.5" />, cor: "text-fx-amber" },
  report: { icone: <ClipboardCheck className="h-3.5 w-3.5" />, cor: "text-fx-amber" },
  quote: { icone: <FileText className="h-3.5 w-3.5" />, cor: "text-fx-coral-p" },
};

const fusoLondres = { timeZone: "Europe/London" } as const;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { ...fusoLondres, hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-GB", fusoLondres);
const rotuloDia = (iso: string) => {
  const d = dia(iso);
  if (d === dia(new Date().toISOString())) return "Today";
  if (d === dia(new Date(Date.now() - 86400_000).toISOString())) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { ...fusoLondres, weekday: "short", day: "numeric", month: "short" });
};

export function LiveActions() {
  const [acoes, setAcoes] = useState<AcaoAoVivo[] | null>(null);
  const [erro, setErro] = useState(false);
  const [novos, setNovos] = useState<Set<string>>(new Set());
  const conhecidos = useRef<Set<string> | null>(null);

  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const buscar = () => {
      fetch("/api/pulse/live")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { acoes: AcaoAoVivo[] }) => {
          if (!vivo) return;
          // O que entrou desde a última busca pisca por alguns segundos.
          const antes = conhecidos.current;
          if (antes) {
            const chegaram = d.acoes.filter((a) => !antes.has(a.id)).map((a) => a.id);
            if (chegaram.length) {
              setNovos(new Set(chegaram));
              setTimeout(() => vivo && setNovos(new Set()), 6000);
            }
          }
          conhecidos.current = new Set(d.acoes.map((a) => a.id));
          setAcoes(d.acoes);
          setErro(false);
        })
        .catch(() => vivo && setErro(true));
    };
    const logo = () => {
      clearTimeout(espera);
      espera = setTimeout(buscar, 800);
    };
    buscar();
    const sb = getSupabase();
    const canal = sb
      .channel("overview-live-actions")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, logo)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, logo)
      .subscribe();
    const reserva = setInterval(buscar, 20_000);
    return () => {
      vivo = false;
      clearTimeout(espera);
      clearInterval(reserva);
      void sb.removeChannel(canal);
    };
  }, []);

  const lista = acoes ?? [];
  return (
    <SectionCard
      className={PULSE_FORECAST_PAIR_CARD_CLASS}
      title={
        <span className="inline-flex items-center gap-2">
          Live actions
          <span className="relative inline-flex h-2 w-2" aria-label="Live">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fx-green opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fx-green" />
          </span>
        </span>
      }
      bodyClassName={cn("p-0", PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS)}
    >
      {acoes === null && !erro ? (
        <div className="space-y-2 px-4 py-3">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-fx-paper-2/40" />)}
        </div>
      ) : erro && !acoes ? (
        <p className="px-4 py-3 text-[12px] text-fx-red">Could not load live actions.</p>
      ) : acoes && acoes.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-text-tertiary">Nothing happened in the last 36 hours.</p>
      ) : (
        <ul className="m-0 list-none p-0 pb-1">
          {lista.map((a, i) => {
            const t = TIPO[a.tipo];
            const d = rotuloDia(a.em);
            const cabecalho = d !== "Today" && (i === 0 || rotuloDia(lista[i - 1].em) !== d) ? d : null;
            const linha = (
              <>
                <span className="w-[38px] shrink-0 text-[11px] tabular-nums text-text-tertiary">{hora(a.em)}</span>
                <span className={cn("shrink-0", t.cor)}>{t.icone}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
                  {a.ref ? <span className="mr-1.5 text-[11px] font-medium text-text-tertiary">{a.ref}</span> : null}
                  {a.texto}
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-[110px] shrink-0 items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    a.bot ? "bg-fx-paper-2 text-text-secondary" : "bg-fx-navy/10 text-fx-navy",
                  )}
                  title={a.quem}
                >
                  {a.bot ? <Bot className="h-3 w-3 shrink-0" /> : null}
                  <span className="truncate">{a.quem}</span>
                </span>
              </>
            );
            const classe = cn(
              "flex items-center gap-2 border-b border-dotted border-fx-line-2 px-4 py-1.5 transition-colors last:border-b-0",
              novos.has(a.id) && "bg-fx-blue-50",
            );
            return (
              <li key={a.id}>
                {cabecalho ? <p className="m-0 bg-fx-paper-2/50 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{cabecalho}</p> : null}
                {a.href ? (
                  <Link href={a.href} className={cn(classe, "hover:bg-fx-paper-2/60")}>
                    {linha}
                  </Link>
                ) : (
                  <div className={classe}>{linha}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
