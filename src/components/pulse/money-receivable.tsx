"use client";

/**
 * O que falta entrar: tudo que está a receber, o vencido de verdade (contas e clientes) e,
 * à parte, o que passou da data mas é de plataforma (Housekeep, Fantastic, Checkatrade),
 * que paga no ciclo dela.
 */
import { pulseMoney } from "@/lib/pulse-money-display";
import { KpiCard } from "@/components/fx/primitives";
import { usePulseCeo } from "./pulse-ceo-data";

export function MoneyReceivable() {
  const { data } = usePulseCeo();
  const d = data?.dinheiro;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      <KpiCard
        label="To Receive"
        hint="Every unpaid invoice (pending, overdue or partly paid), counting only the balance still open."
        countBesideHint={d ? d.aReceber.n : null}
        value={d ? pulseMoney(d.aReceber.valor) : "—"}
      />
      <KpiCard
        label="Overdue"
        hint="Past their due date, from accounts and direct customers. This is the money to chase."
        variant={d && d.vencido.n > 0 ? "alert" : "default"}
        countBesideHint={d ? d.vencido.n : null}
        value={d ? pulseMoney(d.vencido.valor) : "—"}
      />
      <KpiCard
        label="Platforms Past Date"
        hint="Housekeep, Fantastic Services, Checkatrade and Express pay on their own cycle, so these are not chased."
        countBesideHint={d ? d.plataformas.n : null}
        value={d ? pulseMoney(d.plataformas.valor) : "—"}
      />
    </div>
  );
}
