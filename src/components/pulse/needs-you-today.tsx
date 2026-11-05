"use client";

/**
 * Só o que pede ação hoje (dono, 05/11/2026): final review esperando para faturar, faturas
 * vencidas para cobrar e a agenda. O resto da operação mora no Live operations.
 * Sem filtro de datas: é o estado de agora.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { pulseMoney } from "@/lib/pulse-money-display";

type Estado = { revisao: { n: number; valor: number }; agendados: number; emAndamento: number; semParceiro: number; vencido: { n: number; valor: number } | null };

export function NeedsYouToday() {
  const [d, setD] = useState<Estado | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [jobs, receber] = await Promise.all([
        getSupabase()
          .from("jobs")
          .select("status, client_price, extras_amount")
          .in("status", ["final_check", "scheduled", "late", "in_progress", "unassigned", "auto_assigning"])
          .is("deleted_at", null)
          .limit(5000),
        fetch("/api/pulse/receber")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null) as Promise<{ vencido: { n: number; valor: number } } | null>,
      ]);
      if (!vivo) return;
      const linhas = (jobs.data ?? []) as Array<{ status: string; client_price: number | null; extras_amount: number | null }>;
      const revisao = linhas.filter((j) => j.status === "final_check");
      setD({
        revisao: { n: revisao.length, valor: revisao.reduce((t, j) => t + (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0), 0) },
        agendados: linhas.filter((j) => j.status === "scheduled" || j.status === "late").length,
        emAndamento: linhas.filter((j) => j.status === "in_progress").length,
        semParceiro: linhas.filter((j) => j.status === "unassigned" || j.status === "auto_assigning").length,
        vencido: receber?.vencido ?? null,
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const itens: Array<{ titulo: string; sub: string; href: string; alerta: boolean }> = d
    ? [
        { titulo: `${d.revisao.n} in final review`, sub: `${pulseMoney(d.revisao.valor)} waiting to invoice`, href: "/jobs", alerta: d.revisao.n > 0 },
        { titulo: `${d.vencido?.n ?? 0} overdue invoice${d.vencido?.n === 1 ? "" : "s"}`, sub: `${pulseMoney(d.vencido?.valor ?? 0)} to chase`, href: "/finance/billing", alerta: (d.vencido?.n ?? 0) > 0 },
        { titulo: `${d.semParceiro} without a partner`, sub: "Need assigning", href: "/jobs", alerta: d.semParceiro > 0 },
        { titulo: `${d.agendados} scheduled`, sub: `${d.emAndamento} in progress now`, href: "/schedule", alerta: false },
      ]
    : [];

  return (
    <section aria-label="Needs you today">
      <p className="mb-2 text-[12px] font-semibold text-text-secondary">Needs you today</p>
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {d
          ? itens.map((i) => (
              <Link
                key={i.titulo}
                href={i.href}
                className={cn(
                  "group min-w-0 rounded-xl border px-3.5 py-2.5 transition-colors",
                  i.alerta ? "border-fx-coral/30 bg-fx-coral-50 hover:border-fx-coral/60" : "border-fx-line bg-card hover:border-fx-line-strong",
                )}
              >
                <p className={cn("flex items-center justify-between gap-2 text-[13px] font-semibold tabular-nums", i.alerta ? "text-fx-coral-p" : "text-text-primary")}>
                  <span className="truncate">{i.titulo}</span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </p>
                <p className="mt-0.5 truncate text-[12px] text-text-secondary tabular-nums">{i.sub}</p>
              </Link>
            ))
          : [0, 1, 2, 3].map((k) => <div key={k} className="h-[54px] animate-pulse rounded-xl bg-fx-paper-2/60" />)}
      </div>
    </section>
  );
}
