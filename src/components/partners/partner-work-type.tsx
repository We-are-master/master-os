"use client";

/**
 * Que trabalho o parceiro recebe (dono, 26/10/2026): quote e job, ou só job
 * fechado. Grava `job_preferences.receiveLeads`, a mesma chave do onboarding do portal.
 * Regra em src/lib/partner-aceita-quotes.ts.
 */

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { aceitaQuotes } from "@/lib/partner-aceita-quotes";
import type { Partner } from "@/types/database";

const OPCOES = [
  { aceita: true, rotulo: "Quotes and jobs", dica: "Gets invites to bid on quotes, plus booked jobs." },
  { aceita: false, rotulo: "Booked jobs only", dica: "No quote invites. Only booked jobs, manual or auto-assign." },
] as const;

export function WorkTypeChoice({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (aceita: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {OPCOES.map((o) => {
        const ativo = value === o.aceita;
        return (
          <button
            key={o.rotulo}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.aceita)}
            aria-pressed={ativo}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-60",
              ativo ? "border-primary bg-primary/10" : "border-border-light bg-card hover:border-border",
            )}
          >
            <span className={cn("block text-xs font-semibold", ativo ? "text-primary" : "text-text-primary")}>{o.rotulo}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-text-tertiary">{o.dica}</span>
          </button>
        );
      })}
    </div>
  );
}

export function resumoWorkType(partner: Partner): string {
  return aceitaQuotes(partner.job_preferences) ? "Quotes and jobs" : "Booked jobs only";
}

export function PartnerWorkTypeSection({
  partner,
  onPartnerUpdate,
  canEdit,
}: {
  partner: Partner;
  onPartnerUpdate: (p: Partner) => void;
  canEdit: boolean;
}) {
  const [salvando, setSalvando] = useState(false);
  const atual = aceitaQuotes(partner.job_preferences);

  async function mudar(aceita: boolean) {
    if (aceita === atual) return;
    setSalvando(true);
    try {
      // Relê antes de gravar: o parceiro mexe no mesmo json pelo portal.
      const sb = getSupabase();
      const { data: linha, error: e1 } = await sb.from("partners").select("job_preferences").eq("id", partner.id).single();
      if (e1) throw e1;
      const job_preferences = { ...((linha?.job_preferences as Record<string, unknown> | null) ?? {}), receiveLeads: aceita };
      const { data, error } = await sb.from("partners").update({ job_preferences }).eq("id", partner.id).select().single();
      if (error) throw error;
      onPartnerUpdate(data as Partner);
      toast.success(aceita ? "Partner will get quote invites" : "Partner gets booked jobs only");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2 p-4">
      <WorkTypeChoice value={atual} onChange={mudar} disabled={!canEdit || salvando} />
      <p className="text-[11px] text-text-tertiary">The partner picks this when signing up in the Trade Portal.</p>
    </div>
  );
}
