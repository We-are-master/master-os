"use client";

/**
 * E-mails extras do parceiro (dono, 15/10/2026): empresa parceira que pede o e-mail do
 * job também para o escritório ou um sócio. Entram em cópia nos e-mails de job e no
 * "seus jobs de amanhã" (partners.job_cc_emails, mig 328). Salva na hora.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { updatePartner } from "@/services/partners";
import type { Partner } from "@/types/database";

const VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PartnerJobCcEmails({
  partner,
  canEdit,
  onSaved,
}: {
  partner: Partner;
  canEdit: boolean;
  onSaved?: (next: Partner) => void;
}) {
  const [lista, setLista] = useState<string[]>(((partner as Partner & { job_cc_emails?: string[] | null }).job_cc_emails ?? []).filter(Boolean));
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async (proxima: string[]) => {
    const anterior = lista;
    setLista(proxima);
    setSalvando(true);
    try {
      const next = await updatePartner(partner.id, { job_cc_emails: proxima } as Partial<Partner>);
      onSaved?.(next);
    } catch (e) {
      setLista(anterior);
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSalvando(false);
    }
  };

  const adicionar = () => {
    const e = novo.trim().toLowerCase();
    if (!e) return;
    if (!VALIDO.test(e)) {
      toast.error("That email does not look right.");
      return;
    }
    if (e === (partner.email ?? "").trim().toLowerCase() || lista.includes(e)) {
      setNovo("");
      return;
    }
    setNovo("");
    void salvar([...lista, e]);
  };

  return (
    <div className="col-span-2 min-w-0">
      <p className="m-0 mb-1 flex items-center gap-1 text-[11px] text-text-tertiary">
        Also send job emails to
        <FixfyHintIcon text="Copies of every job email (booked, rescheduled, cancelled, on hold, tomorrow's jobs) go to these addresses too, in the same thread. The main email above stays the one the partner logs in with." />
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {lista.map((e) => (
          <span key={e} className="inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-surface-hover px-2 text-[11px] text-text-primary">
            {e}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${e}`}
                disabled={salvando}
                onClick={() => void salvar(lista.filter((x) => x !== e))}
                className="text-text-tertiary hover:text-[var(--bad,#dc2626)]"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {canEdit ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="email"
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  adicionar();
                }
              }}
              placeholder="office@company.co.uk"
              className="h-[24px] w-48 rounded-[6px] border border-border bg-card px-2 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-text-tertiary"
            />
            <button
              type="button"
              onClick={adicionar}
              disabled={salvando || !novo.trim()}
              aria-label="Add email"
              className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[6px] border border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
            </button>
          </span>
        ) : lista.length === 0 ? (
          <span className="text-[11px] text-text-tertiary">None</span>
        ) : null}
      </div>
    </div>
  );
}
