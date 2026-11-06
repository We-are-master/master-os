"use client";

/**
 * A ponte de uma quote para o CRM (06/11/2026, dono): mostra em que coluna o
 * card dela está e abre o CRM nele. Quote sem card: "Add to CRM" pede ao
 * servidor para ligar ao lead do ticket ou criar o card (mesma regra da
 * sincronização das quotes).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import { useStageLabels } from "./use-stage-labels";
import type { LeadStage } from "@/types/database";

type LeadDoChip = { id: string; reference: string | null; stage: LeadStage };

export function crmLeadHref(leadId: string): string {
  return `/leads?leadId=${encodeURIComponent(leadId)}`;
}

export function CrmLeadChip({ quoteId, leadId: leadIdInicial }: { quoteId: string; leadId?: string | null }) {
  const labels = useStageLabels();
  const [lead, setLead] = useState<LeadDoChip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    const sb = getSupabase();
    let id = leadIdInicial ?? null;
    if (!id) {
      const { data } = await sb.from("quotes").select("lead_id").eq("id", quoteId).maybeSingle();
      id = (data as { lead_id?: string | null } | null)?.lead_id ?? null;
    }
    if (!id) {
      setLead(null);
      setLoaded(true);
      return;
    }
    const { data } = await sb.from("leads").select("id, reference, stage").eq("id", id).is("deleted_at", null).maybeSingle();
    setLead((data as LeadDoChip | null) ?? null);
    setLoaded(true);
  }, [quoteId, leadIdInicial]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const adicionar = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/crm/leads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not add to the CRM");
      await carregar();
      toast.success("Added to the CRM");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to the CRM");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  if (!lead) {
    return (
      <button
        type="button"
        onClick={adicionar}
        disabled={busy}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-border-light px-2 text-[11px] font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Add to CRM
      </button>
    );
  }
  return (
    <Link
      href={crmLeadHref(lead.id)}
      title={`Open ${lead.reference ?? "the lead"} in the CRM`}
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary-light px-2 text-[11px] font-medium text-primary hover:bg-primary hover:text-white"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      CRM · {labels[lead.stage] ?? lead.stage}
    </Link>
  );
}
