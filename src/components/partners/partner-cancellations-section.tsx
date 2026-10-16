"use client";

/**
 * Cancelamentos que o parceiro fez pelo portal (305), com a penalidade pela
 * regra em vigor. A equipe aprova (vira desconto na self-bill) ou isenta
 * (doença, emergência), com um motivo.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";

type Cancelamento = {
  id: string;
  cancelled_at: string;
  hours_before: number | null;
  penalty_amount: number;
  rule: string;
  reason: string | null;
  status: "pending" | "approved" | "waived";
  decision_note: string | null;
  jobs: { reference: string; title: string | null } | null;
};

const REGRA: Record<string, string> = { v1_50gbp_24h: "£50 under 24h", v2_50pct_36h: "50% under 36h" };

export function PartnerCancellationsSection({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  const [linhas, setLinhas] = useState<Cancelamento[]>([]);
  const [nota, setNota] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function carregar() {
    const { data, error } = await getSupabase()
      .from("partner_cancellations")
      .select("id, cancelled_at, hours_before, penalty_amount, rule, reason, status, decision_note, jobs(reference, title)")
      .eq("partner_id", partnerId)
      .order("cancelled_at", { ascending: false })
      .limit(20);
    if (!error) setLinhas((data ?? []) as unknown as Cancelamento[]);
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  async function decidir(id: string, status: "approved" | "waived") {
    const motivo = nota[id]?.trim() ?? "";
    if (status === "waived" && !motivo && linhas.find((l) => l.id === id)?.penalty_amount) {
      toast.error("Write why the penalty is waived");
      return;
    }
    setOcupado(id);
    try {
      const { data: auth } = await getSupabase().auth.getUser();
      const { error } = await getSupabase()
        .from("partner_cancellations")
        .update({ status, decision_note: motivo || null, decided_at: new Date().toISOString(), decided_by: auth.user?.id ?? null })
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
      toast.success(status === "approved" ? "Penalty approved: it goes on the next self-bill" : "Penalty waived");
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setOcupado(null);
    }
  }

  if (!linhas.length) return <p className="p-4 text-sm text-text-tertiary">No cancellations.</p>;

  return (
    <div className="space-y-3 p-4">
      {linhas.map((c) => (
        <div key={c.id} className="space-y-2 rounded-lg border border-border-light p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                {c.jobs?.reference ?? "Job"} {c.jobs?.title ? <span className="font-normal text-text-secondary">· {c.jobs.title}</span> : null}
              </p>
              <p className="text-xs text-text-tertiary">
                {new Date(c.cancelled_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}
                {c.hours_before != null ? ` · ${c.hours_before}h before arrival` : ""} · rule {REGRA[c.rule] ?? c.rule}
              </p>
              {c.reason ? <p className="mt-1 text-xs text-text-secondary">“{c.reason}”</p> : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-text-primary">{formatCurrency(Number(c.penalty_amount) || 0)}</p>
              <p className="text-xs capitalize text-text-tertiary">{c.status}</p>
            </div>
          </div>
          {c.status === "pending" && canEdit ? (
            Number(c.penalty_amount) > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 min-w-0 flex-1" placeholder="Note (required to waive)" value={nota[c.id] ?? ""} onChange={(e) => setNota((n) => ({ ...n, [c.id]: e.target.value }))} />
                <Button size="sm" variant="outline" loading={ocupado === c.id} onClick={() => void decidir(c.id, "waived")}>
                  Waive
                </Button>
                <Button size="sm" loading={ocupado === c.id} onClick={() => void decidir(c.id, "approved")}>
                  Approve
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" loading={ocupado === c.id} onClick={() => void decidir(c.id, "waived")}>
                Mark as seen
              </Button>
            )
          ) : c.decision_note ? (
            <p className="text-xs text-text-tertiary">Note: {c.decision_note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
