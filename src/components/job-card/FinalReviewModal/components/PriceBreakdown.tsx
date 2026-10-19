"use client";

import type { FinalReviewBreakdown } from "../types";

const gbp = (n: number) => `£${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const horas = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

/**
 * Quadro de valores da Final review (dono, 19/10/2026): de onde sai cada número.
 *
 * Por hora: horas × taxa de cada lado. Preço fechado: o valor combinado de cada lado.
 * Depois os extras (com o material dos relatórios separado), as visitas extras, os
 * totais e a nossa margem. Cliente à esquerda, parceiro à direita, como no resto do OS.
 */
export function PriceBreakdown({ b, materialFromReports }: { b: FinalReviewBreakdown; materialFromReports: number }) {
  const hourly = b.type === "hourly";
  const materialCliente = Math.min(Math.max(0, materialFromReports), b.clientExtras);
  const outrosExtrasCliente = Math.max(0, Math.round((b.clientExtras - materialCliente) * 100) / 100);

  const linhas: Array<{ rotulo: string; cliente: number | null; parceiro: number | null; nota?: string }> = [
    {
      rotulo: hourly ? `Labour · ${b.hours != null ? horas(b.hours) : "?"} billed` : "Agreed price",
      cliente: b.clientBase,
      parceiro: b.partnerBase,
      nota: hourly
        ? `${gbp(b.clientRate ?? 0)}/h client · ${gbp(b.partnerRate ?? 0)}/h partner`
        : undefined,
    },
  ];
  if (materialCliente > 0 || b.partnerMaterials > 0) {
    linhas.push({ rotulo: "Materials on site", cliente: materialCliente, parceiro: b.partnerMaterials, nota: "client charge · partner reimbursed" });
  }
  if (outrosExtrasCliente > 0 || b.partnerExtras > 0) {
    linhas.push({ rotulo: "Other extras", cliente: outrosExtrasCliente, parceiro: b.partnerExtras });
  }
  if (b.visitsCount > 0) {
    linhas.push({
      rotulo: `Extra visits · ${b.visitsCount}`,
      cliente: b.visitsClient,
      parceiro: b.visitsPartner,
      nota: "partner paid on each visit's self-bill",
    });
  }
  const parceiroTotal = b.partnerTotal + b.visitsPartner;

  return (
    <div className="mx-[22px] mt-3 overflow-hidden rounded-xl" style={{ border: "0.5px solid #E4E4E7" }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: "#F7F7FB", borderBottom: "0.5px solid #E4E4E7" }}>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={hourly ? { background: "#E8F1FF", color: "#1D4ED8" } : { background: "#F2F0FA", color: "#020040" }}
        >
          {hourly ? "Hourly" : "Fixed price"}
        </span>
        <span className="text-[11px]" style={{ color: "#6B6B70" }}>
          {hourly && b.hours != null ? `${horas(b.hours)} billed · min 1h, then every 30 min` : "Same price whatever the time"}
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ color: "#9A9AA0" }}>
            <th className="px-3 pt-2 text-left text-[10px] font-semibold uppercase tracking-wide" />
            <th className="px-3 pt-2 text-right text-[10px] font-semibold uppercase tracking-wide">Client</th>
            <th className="px-3 pt-2 text-right text-[10px] font-semibold uppercase tracking-wide">Partner</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <td className="px-3 py-1.5 align-top" style={{ color: "#020040" }}>
                {l.rotulo}
                {l.nota ? <span className="block text-[10px]" style={{ color: "#9A9AA0" }}>{l.nota}</span> : null}
              </td>
              <td className="px-3 py-1.5 text-right align-top tabular-nums" style={{ color: "#047857" }}>{l.cliente != null ? gbp(l.cliente) : "—"}</td>
              <td className="px-3 py-1.5 text-right align-top tabular-nums" style={{ color: "#B42318" }}>{l.parceiro != null ? gbp(l.parceiro) : "—"}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "0.5px solid #E4E4E7" }}>
            <td className="px-3 py-2 font-semibold" style={{ color: "#020040" }}>Total</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "#047857" }}>{gbp(b.clientTotal)}</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "#B42318" }}>{gbp(parceiroTotal)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center justify-between px-3 py-2" style={{ background: b.margin < 0 ? "#FEF3F2" : "#ECFDF3", borderTop: "0.5px solid #E4E4E7" }}>
        <span className="text-[12px] font-semibold" style={{ color: "#020040" }}>Our margin</span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: b.margin < 0 ? "#B42318" : "#047857" }}>
          {gbp(b.margin)} · {b.marginPct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
