"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Paperclip, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { ukWallClockToUtcIso, utcIsoToUkWallClock } from "@/lib/utils/uk-time";
import { jobListClientAmount, jobListPartnerCost } from "@/lib/job-financials";
import {
  computeVisitDoneAmounts,
  jobTotalsAfterVisit,
  visitDoneProblems,
  type VisitDoneAmounts,
  type VisitDoneInput,
  type VisitRateType,
} from "@/lib/visit-done-billing";
import type { Job, JobVisit } from "@/types/database";

/**
 * O Done de uma visita extra (dono, 22/10/2026): antes de fechar, confirma quanto
 * a visita custou. Hourly pede chegada e saída; Fixed mostra o combinado. Os dois
 * aceitam material com recibo. Os totais aparecem sempre, mesmo em £0, junto com
 * os totais do job depois desta visita. Cancelar deixa a visita aberta.
 */
export function VisitDoneModal({
  job,
  visit,
  onClose,
  onDone,
}: {
  job: Job;
  visit: JobVisit;
  onClose: () => void;
  onDone: (result: { visit: JobVisit; amounts: VisitDoneAmounts; payoutError: string | null }) => void;
}) {
  const relatorio = ((visit.final_report as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
  const hm = (iso?: string | null) => (iso ? utcIsoToUkWallClock(iso)?.hm ?? "" : "");
  const dia = visit.scheduled_date ?? new Date().toISOString().slice(0, 10);

  const [rateType, setRateType] = useState<VisitRateType | "">(
    visit.job_type === "hourly" || visit.job_type === "fixed"
      ? visit.job_type
      : Number(visit.hourly_client_rate ?? 0) > 0 || Number(visit.hourly_partner_rate ?? 0) > 0
        ? "hourly"
        : "",
  );
  const [chegada, setChegada] = useState(hm(visit.arrived_at ?? visit.scheduled_start_at));
  const [saida, setSaida] = useState(hm(visit.departed_at ?? visit.scheduled_end_at));
  const [taxaCliente, setTaxaCliente] = useState(String(visit.hourly_client_rate ?? job.hourly_client_rate ?? ""));
  const [taxaParceiro, setTaxaParceiro] = useState(String(visit.hourly_partner_rate ?? job.hourly_partner_rate ?? ""));
  const [clienteEditado, setClienteEditado] = useState<string>("");
  const [parceiroEditado, setParceiroEditado] = useState<string>("");
  const [precoCliente, setPrecoCliente] = useState(String(visit.client_price ?? 0));
  const [custoParceiro, setCustoParceiro] = useState(String(visit.partner_cost ?? 0));
  const [extra, setExtra] = useState("");
  const [materialCusto, setMaterialCusto] = useState(String(relatorio.materials_extra_cost ?? ""));
  const [materialCobranca, setMaterialCobranca] = useState(String(relatorio.materials_extra_charge ?? ""));
  const [recibos, setRecibos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const recibosJa = Array.isArray(visit.materials_receipts) ? visit.materials_receipts.length : 0;

  const input: VisitDoneInput | null = useMemo(() => {
    if (!rateType) return null;
    const iso = (t: string) => (t ? ukWallClockToUtcIso(dia, t) : null);
    return {
      rateType,
      arrivedAt: iso(chegada),
      departedAt: iso(saida),
      hourlyClientRate: Number(taxaCliente) || 0,
      hourlyPartnerRate: Number(taxaParceiro) || 0,
      clientOverride: clienteEditado === "" ? null : Number(clienteEditado),
      partnerOverride: parceiroEditado === "" ? null : Number(parceiroEditado),
      clientPrice: Number(precoCliente) || 0,
      partnerCost: Number(custoParceiro) || 0,
      extraClientCharge: Number(extra) || 0,
      materialsCost: Number(materialCusto) || 0,
      materialsCharge: materialCobranca === "" ? null : Number(materialCobranca),
      receiptCount: recibosJa + recibos.length,
    };
  }, [rateType, dia, chegada, saida, taxaCliente, taxaParceiro, clienteEditado, parceiroEditado, precoCliente, custoParceiro, extra, materialCusto, materialCobranca, recibos.length, recibosJa]);

  const valores = input ? computeVisitDoneAmounts(input) : null;
  const problemas = input ? visitDoneProblems(input) : ["Choose Hourly or Fixed"];
  const totaisDoJob = valores
    ? jobTotalsAfterVisit({
        jobClient: jobListClientAmount(job),
        jobPartner: jobListPartnerCost(job),
        visitClientBefore: Number(visit.client_price ?? 0),
        visitPartnerBefore: Number(visit.partner_cost ?? 0),
        amounts: valores,
        materialsChargeBefore: Number(relatorio.materials_extra_charge ?? 0),
      })
    : null;

  async function confirmar() {
    if (!input || problemas.length) {
      toast.error(problemas[0] ?? "Check the values");
      return;
    }
    setSalvando(true);
    try {
      const fd = new FormData();
      fd.set("visitId", visit.id);
      fd.set("payload", JSON.stringify(input));
      for (const f of recibos) fd.append("receipt", f);
      const res = await fetch(`/api/jobs/${job.id}/visits/complete`, { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string; visit?: JobVisit; amounts?: VisitDoneAmounts; payoutError?: string | null;
      };
      if (!res.ok || !json.visit || !json.amounts) throw new Error(json.error ?? `Could not close the visit (${res.status})`);
      onDone({ visit: json.visit, amounts: json.amounts, payoutError: json.payoutError ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close the visit");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={salvando ? () => undefined : onClose} title={`Visit ${visit.visit_index} done`} size="md">
      <div className="space-y-3 p-1">
        <p className="m-0 text-[12px] text-text-tertiary">
          {visit.partner_name?.trim() || "Partner"} · {dia}. Confirm what this visit costs before closing it.
        </p>

        <section className={BLOCO}>
          <p className={SECAO}>How is this visit charged?</p>
          <div role="radiogroup" aria-label="Rate type" className="grid grid-cols-2 gap-2">
            {(["hourly", "fixed"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={rateType === t}
                onClick={() => setRateType(t)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition-colors",
                  rateType === t ? "border-primary bg-primary/5 text-text-primary" : "border-border-light bg-surface text-text-secondary hover:border-text-tertiary",
                )}
              >
                {t === "hourly" ? "Hourly" : "Fixed"}
              </button>
            ))}
          </div>
        </section>

        {rateType === "hourly" ? (
          <section className={BLOCO}>
            <p className={SECAO}>Time on site</p>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Arrival">
                <Input type="time" value={chegada} onChange={(e) => setChegada(e.target.value)} />
              </Campo>
              <Campo rotulo="Departure">
                <Input type="time" value={saida} onChange={(e) => setSaida(e.target.value)} />
              </Campo>
              <Campo rotulo="Client rate (£/h)">
                <Input type="number" min={0} step="0.01" value={taxaCliente} onChange={(e) => { setTaxaCliente(e.target.value); setClienteEditado(""); }} />
              </Campo>
              <Campo rotulo="Partner rate (£/h)">
                <Input type="number" min={0} step="0.01" value={taxaParceiro} onChange={(e) => { setTaxaParceiro(e.target.value); setParceiroEditado(""); }} />
              </Campo>
            </div>
            <p className="m-0 text-[11px] text-text-tertiary tabular-nums">
              {valores?.billedHours != null
                ? `${valores.billedHours} h billed (first hour minimum, then by the half hour)`
                : "Enter arrival and departure to work out the hours"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Client charge (£)">
                <Input type="number" min={0} step="0.01" value={clienteEditado !== "" ? clienteEditado : String(valores?.clientPrice ?? 0)} onChange={(e) => setClienteEditado(e.target.value)} />
              </Campo>
              <Campo rotulo="Partner pay (£)">
                <Input type="number" min={0} step="0.01" value={parceiroEditado !== "" ? parceiroEditado : String(valores?.partnerCost ?? 0)} onChange={(e) => setParceiroEditado(e.target.value)} />
              </Campo>
            </div>
          </section>
        ) : rateType === "fixed" ? (
          <section className={BLOCO}>
            <p className={SECAO}>Agreed price</p>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Client price (£)">
                <Input type="number" min={0} step="0.01" value={precoCliente} onChange={(e) => setPrecoCliente(e.target.value)} />
              </Campo>
              <Campo rotulo="Partner cost (£)">
                <Input type="number" min={0} step="0.01" value={custoParceiro} onChange={(e) => setCustoParceiro(e.target.value)} />
              </Campo>
              <Campo rotulo="Extra charge to the client (£, optional)" span>
                <Input type="number" min={0} step="0.01" value={extra} placeholder="0.00" onChange={(e) => setExtra(e.target.value)} />
              </Campo>
            </div>
          </section>
        ) : null}

        {rateType ? (
          <section className={BLOCO}>
            <p className={SECAO}>Materials (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Partner paid (£)">
                <Input type="number" min={0} step="0.01" value={materialCusto} placeholder="0.00" onChange={(e) => setMaterialCusto(e.target.value)} />
              </Campo>
              <Campo rotulo="Client pays (£)">
                <Input
                  type="number" min={0} step="0.01"
                  value={materialCobranca !== "" ? materialCobranca : valores && valores.materialsCost > 0 ? String(valores.materialsCharge) : ""}
                  placeholder="0.00"
                  onChange={(e) => setMaterialCobranca(e.target.value)}
                />
              </Campo>
            </div>
            {Number(materialCusto) > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
                <Paperclip className="h-3.5 w-3.5" />
                <span>{recibos.length + recibosJa > 0 ? `${recibos.length + recibosJa} receipt(s)` : "Add the receipt (required)"}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => setRecibos((r) => [...r, ...Array.from(e.target.files ?? [])])}
                />
              </label>
            ) : null}
          </section>
        ) : null}

        {valores && totaisDoJob ? (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-[13px] tabular-nums">
            <p className="m-0 font-semibold text-text-primary">
              Client to charge {formatCurrency(valores.clientToCharge)} · Partner to pay {formatCurrency(valores.partnerToPay)}
            </p>
            <p className="m-0 mt-1 text-[11px] text-text-tertiary">
              Job after this visit: client {formatCurrency(totaisDoJob.client)} · partner {formatCurrency(totaisDoJob.partner)} · margin {formatCurrency(totaisDoJob.margin)}
            </p>
          </section>
        ) : null}

        {problemas.length && rateType ? <p className="m-0 text-[11px] text-amber-700 dark:text-amber-400">{problemas[0]}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onClose} disabled={salvando}>
            Cancel
          </Button>
          <Button type="button" size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => void confirmar()} disabled={salvando || problemas.length > 0}>
            {salvando ? "Closing…" : "Confirm and mark done"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Campo({ rotulo, children, span }: { rotulo: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : undefined}>
      <label className="mb-1 block text-xs font-semibold text-text-secondary">{rotulo}</label>
      {children}
    </div>
  );
}

const SECAO = "m-0 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary";
const BLOCO = "space-y-2 rounded-xl border border-border-light bg-surface-secondary/40 p-3";
