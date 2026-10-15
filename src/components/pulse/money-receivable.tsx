"use client";

/**
 * Dinheiro dos clientes no período do filtro (dono, 15/10/2026): o que está para
 * entrar, o que venceu e o que entrou. Plataforma (Housekeep, Fantastic, Checkatrade,
 * Express) passada da data conta em Awaiting payment, porque paga no ciclo dela.
 */
import { useEffect, useState } from "react";
import { pulseMoney } from "@/lib/pulse-money-display";
import { KpiCard } from "@/components/fx/primitives";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";

type Soma = { n: number; valor: number };
type Receber = { aguardando: Soma; vencido: Soma; pago: Soma };

export function MoneyReceivable() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const chave = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const [estado, setEstado] = useState<{ chave: string; d: Receber } | null>(null);
  useEffect(() => {
    let vivo = true;
    const [de, ate] = chave === "all" ? ["", ""] : chave.split("|");
    const qs = de ? `?from=${encodeURIComponent(de)}&to=${encodeURIComponent(ate!)}` : "";
    fetch(`/api/pulse/receber${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Receber | null) => {
        if (vivo && d) setEstado({ chave, d });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [chave]);
  const d = estado?.chave === chave ? estado.d : null;
  const periodo = bounds ? `due ${rangeLabel || "in the selected period"}` : "all open invoices";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      <KpiCard
        label="Awaiting Payment"
        hint={`Unpaid invoices ${periodo} that are not overdue yet, counting the open balance. Platforms past their date are here too: they pay on their own cycle.`}
        countBesideHint={d ? d.aguardando.n : null}
        value={d ? pulseMoney(d.aguardando.valor) : "—"}
      />
      <KpiCard
        label="Overdue"
        hint={`Unpaid invoices ${periodo} already past their due date, from accounts and direct customers. This is the money to chase.`}
        variant={d && d.vencido.n > 0 ? "alert" : "default"}
        countBesideHint={d ? d.vencido.n : null}
        value={d ? pulseMoney(d.vencido.valor) : "—"}
      />
      <KpiCard
        label="Paid"
        hint={bounds ? `Money received ${rangeLabel || "in the selected period"} (invoice payment date).` : "Money received this month (invoice payment date)."}
        countBesideHint={d ? d.pago.n : null}
        value={d ? pulseMoney(d.pago.valor) : "—"}
      />
    </div>
  );
}
