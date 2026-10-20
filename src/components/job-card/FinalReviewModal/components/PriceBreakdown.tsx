"use client";

import type { FinalReviewBreakdown } from "../types";

const gbp = (n: number) => `£${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const horas = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;

/** Mesma grade em cabeçalho, linhas e rodapé: os números ficam na mesma coluna. */
const GRADE = "grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-start gap-x-3 px-4";

type Linha = {
  rotulo: string;
  detalhe?: string;
  cliente: number;
  parceiro: number;
  /** Texto pequeno embaixo de cada valor (taxa por hora). */
  notaCliente?: string;
  notaParceiro?: string;
};

/**
 * Quadro de valores da Final review (dono, 19/10/2026): como o valor do job se forma.
 *
 * Por hora: horas × taxa de cada lado. Preço fechado: o valor combinado de cada lado.
 * Depois material, outros extras e visitas adicionais; o total de cada lado e a
 * margem bruta. Cliente à esquerda, parceiro à direita, como no resto do OS.
 */
export function PriceBreakdown({ b, materialFromReports }: { b: FinalReviewBreakdown; materialFromReports: number }) {
  const hourly = b.type === "hourly";
  const materialCliente = Math.min(Math.max(0, materialFromReports), b.clientExtras);
  const outrosExtrasCliente = Math.max(0, Math.round((b.clientExtras - materialCliente) * 100) / 100);

  const linhas: Linha[] = [
    hourly
      ? {
          rotulo: "Labour",
          detalhe: b.hours != null ? `${horas(b.hours)} billed` : undefined,
          cliente: b.clientBase,
          parceiro: b.partnerBase,
          notaCliente: b.clientRate != null ? `@ ${gbp(b.clientRate)}/h` : undefined,
          notaParceiro: b.partnerRate != null ? `@ ${gbp(b.partnerRate)}/h` : undefined,
        }
      : { rotulo: "Agreed price", detalhe: "Fixed for the job", cliente: b.clientBase, parceiro: b.partnerBase },
  ];
  if (materialCliente > 0 || b.partnerMaterials > 0) {
    linhas.push({
      rotulo: "Materials",
      detalhe: "Charged to the client, reimbursed to the partner",
      cliente: materialCliente,
      parceiro: b.partnerMaterials,
    });
  }
  if (outrosExtrasCliente > 0 || b.partnerExtras > 0) {
    linhas.push({ rotulo: "Additional charges", cliente: outrosExtrasCliente, parceiro: b.partnerExtras });
  }
  if (b.visitsCount > 0) {
    linhas.push({
      rotulo: `Additional visits (${b.visitsCount})`,
      detalhe: "Partner paid on each visit's self-bill",
      cliente: b.visitsClient,
      parceiro: b.visitsPartner,
    });
  }
  const parceiroTotal = b.partnerTotal + b.visitsPartner;
  const negativa = b.margin < 0;

  return (
    <div className="mx-[22px] mt-3 overflow-hidden rounded-xl bg-white" style={{ border: "0.5px solid #E4E4E7" }}>
      {/* Cabeçalho: modo de cobrança e a regra dele. */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ background: "#F7F7FB", borderBottom: "0.5px solid #E4E4E7" }}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: "#020040" }}>Price breakdown</span>
          <span
            className="rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide"
            style={hourly ? { background: "#E8F1FF", color: "#1D4ED8" } : { background: "#EEEDF7", color: "#020040" }}
          >
            {hourly ? "Hourly rate" : "Fixed price"}
          </span>
        </div>
        <span className="text-[11px]" style={{ color: "#6B6B70" }}>
          {hourly ? "1 h minimum, then 30 min increments" : "Price does not depend on time on site"}
        </span>
      </div>

      {/* Títulos das colunas, na mesma grade dos valores. */}
      <div className={`${GRADE} pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide`} style={{ color: "#9A9AA0" }}>
        <span>Item</span>
        <span className="text-right">Client</span>
        <span className="text-right">Partner</span>
      </div>

      {linhas.map((l) => (
        <div key={l.rotulo} className={`${GRADE} py-1.5 text-[12px]`}>
          <div className="min-w-0">
            <p className="m-0 font-medium" style={{ color: "#020040" }}>{l.rotulo}</p>
            {l.detalhe ? <p className="m-0 text-[10.5px] leading-snug" style={{ color: "#9A9AA0" }}>{l.detalhe}</p> : null}
          </div>
          <div className="text-right tabular-nums">
            <p className="m-0" style={{ color: "#020040" }}>{gbp(l.cliente)}</p>
            {l.notaCliente ? <p className="m-0 text-[10.5px]" style={{ color: "#9A9AA0" }}>{l.notaCliente}</p> : null}
          </div>
          <div className="text-right tabular-nums">
            <p className="m-0" style={{ color: "#020040" }}>{gbp(l.parceiro)}</p>
            {l.notaParceiro ? <p className="m-0 text-[10.5px]" style={{ color: "#9A9AA0" }}>{l.notaParceiro}</p> : null}
          </div>
        </div>
      ))}

      {/* Rodapé: totais na mesma coluna dos valores, margem alinhada à direita. */}
      <div className={`${GRADE} mt-1 py-2 text-[12.5px] font-semibold tabular-nums`} style={{ borderTop: "0.5px solid #E4E4E7", color: "#020040" }}>
        <span>Total</span>
        <span className="text-right" style={{ color: "#047857" }}>{gbp(b.clientTotal)}</span>
        <span className="text-right" style={{ color: "#B42318" }}>{gbp(parceiroTotal)}</span>
      </div>
      <div
        className={`${GRADE} py-2 text-[12.5px] font-semibold tabular-nums`}
        style={{ background: negativa ? "#FEF3F2" : "#ECFDF3", borderTop: "0.5px solid #E4E4E7", color: "#020040" }}
      >
        <span>Gross margin</span>
        <span className="text-right" style={{ color: negativa ? "#B42318" : "#047857" }}>{b.marginPct.toFixed(1)}%</span>
        <span className="text-right" style={{ color: negativa ? "#B42318" : "#047857" }}>{gbp(b.margin)}</span>
      </div>
    </div>
  );
}
