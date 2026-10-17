"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  extraFromHours,
  partnerAmountFromShare,
  type FinalReviewExtra,
} from "@/lib/job-final-extra";

/**
 * Janela "Add extra" do Final review (17/10/2026): horas extras ou valor fechado, com os
 * novos totais do cliente e do parceiro antes de confirmar. Só devolve o extra; quem grava
 * é o "Send report & finalise".
 */
type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (extra: FinalReviewExtra) => void;
  initial: FinalReviewExtra | null;
  defaults: { clientRate: number; partnerRate: number; partnerShare: number };
  base: { client: number; partner: number };
};

const gbp = (n: number) => `£${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

export function AddExtraModal({ open, onClose, onConfirm, initial, defaults, base }: Props) {
  const [kind, setKind] = useState<"hours" | "amount">("hours");
  const [hours, setHours] = useState("1");
  const [clientRate, setClientRate] = useState(String(defaults.clientRate));
  const [partnerRate, setPartnerRate] = useState(String(defaults.partnerRate));
  const [clientAmount, setClientAmount] = useState("");
  const [partnerAmount, setPartnerAmount] = useState("");
  const [partnerTouched, setPartnerTouched] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? "hours");
    setHours(String(initial?.hours ?? 1));
    setClientRate(String(initial?.clientRate ?? defaults.clientRate));
    setPartnerRate(String(initial?.partnerRate ?? defaults.partnerRate));
    setClientAmount(initial?.kind === "amount" ? String(initial.clientAmount) : "");
    setPartnerAmount(initial?.kind === "amount" ? String(initial.partnerAmount) : "");
    setPartnerTouched(initial?.kind === "amount");
    setReason(initial?.reason ?? "");
  }, [open, initial, defaults.clientRate, defaults.partnerRate]);

  const valores = useMemo(() => {
    if (kind === "hours") {
      return extraFromHours({ hours: Number(hours), clientRate: Number(clientRate), partnerRate: Number(partnerRate) });
    }
    const c = Math.max(0, Number(clientAmount) || 0);
    const p = partnerTouched ? Math.max(0, Number(partnerAmount) || 0) : partnerAmountFromShare(c, defaults.partnerShare);
    return { clientAmount: Math.round(c * 100) / 100, partnerAmount: Math.round(p * 100) / 100 };
  }, [kind, hours, clientRate, partnerRate, clientAmount, partnerAmount, partnerTouched, defaults.partnerShare]);

  if (!open) return null;

  // Parceiro recebendo mais que o cliente paga é permitido (dono, 17/10/2026): fica só o aviso.
  const invalido = valores.clientAmount <= 0 && valores.partnerAmount <= 0;
  const input = "h-9 w-full rounded-lg border border-fx-line bg-card px-2.5 text-[13px] text-text-primary";
  const rotulo = "block text-[11px] font-medium text-text-secondary mb-1";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-fx-line bg-card shadow-modal">
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: "0.5px solid #E4E4E7" }}>
          <span className="text-[14px] font-medium" style={{ color: "#020040" }}>Add extra</span>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1" style={{ color: "#9A9AA0" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: "#F4F4F5" }}>
            {(["hours", "amount"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="rounded-md py-1.5 text-[12px] font-medium"
                style={kind === k ? { background: "#020040", color: "#fff" } : { color: "#4A4A55" }}
              >
                {k === "hours" ? "Extra hours" : "Extra amount"}
              </button>
            ))}
          </div>

          {kind === "hours" ? (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={rotulo} htmlFor="extra-hours">Hours</label>
                <input id="extra-hours" type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={input} />
              </div>
              <div>
                <label className={rotulo} htmlFor="extra-client-rate">Client £/h</label>
                <input id="extra-client-rate" type="number" min="0" step="1" value={clientRate} onChange={(e) => setClientRate(e.target.value)} className={input} />
              </div>
              <div>
                <label className={rotulo} htmlFor="extra-partner-rate">Partner £/h</label>
                <input id="extra-partner-rate" type="number" min="0" step="1" value={partnerRate} onChange={(e) => setPartnerRate(e.target.value)} className={input} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={rotulo} htmlFor="extra-client-amount">Charge the client (£)</label>
                <input id="extra-client-amount" type="number" min="0" step="0.01" value={clientAmount} onChange={(e) => setClientAmount(e.target.value)} className={input} placeholder="0.00" />
              </div>
              <div>
                <label className={rotulo} htmlFor="extra-partner-amount">Pay the partner (£)</label>
                <input
                  id="extra-partner-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={partnerTouched ? partnerAmount : valores.partnerAmount ? String(valores.partnerAmount) : ""}
                  onChange={(e) => {
                    setPartnerTouched(true);
                    setPartnerAmount(e.target.value);
                  }}
                  className={input}
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          <div>
            <label className={rotulo} htmlFor="extra-reason">Reason (optional)</label>
            <input id="extra-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={input} placeholder="Extra shelf fitted, longer than booked…" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl px-3 py-2.5" style={{ background: "#F2F0FA" }}>
              <p className="m-0 text-[11px]" style={{ color: "#6B6B70" }}>To be charged</p>
              <p className="m-0 text-[17px] font-semibold tabular-nums" style={{ color: "#020040" }}>{gbp(base.client + valores.clientAmount)}</p>
              <p className="m-0 text-[11px] tabular-nums" style={{ color: "#6B6B70" }}>was {gbp(base.client)} · +{gbp(valores.clientAmount)}</p>
            </div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: "#FFF1EB" }}>
              <p className="m-0 text-[11px]" style={{ color: "#6B6B70" }}>To be paid</p>
              <p className="m-0 text-[17px] font-semibold tabular-nums" style={{ color: "#ED4B00" }}>{gbp(base.partner + valores.partnerAmount)}</p>
              <p className="m-0 text-[11px] tabular-nums" style={{ color: "#6B6B70" }}>was {gbp(base.partner)} · +{gbp(valores.partnerAmount)}</p>
            </div>
          </div>
          {valores.partnerAmount > valores.clientAmount ? (
            <p className="m-0 text-[11px]" style={{ color: "#B45309" }}>
              The partner gets more than the client pays for this extra. Fine when authorised.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-4">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-fx-line px-3 text-[13px]" style={{ color: "#020040" }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={invalido}
            onClick={() =>
              onConfirm({
                kind,
                ...(kind === "hours" ? { hours: Number(hours), clientRate: Number(clientRate), partnerRate: Number(partnerRate) } : {}),
                clientAmount: valores.clientAmount,
                partnerAmount: valores.partnerAmount,
                reason: reason.trim(),
              })
            }
            className="h-9 rounded-lg px-4 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ background: "#020040" }}
          >
            Confirm extra
          </button>
        </div>
      </div>
    </div>
  );
}
