"use client";

/**
 * "Add to CRM" do Atendimento (06/11/2026, dono): escolhe a coluna em que o
 * card nasce. Quoting segue o mesmo caminho de arrastar o card: o card nasce
 * em Qualified e abre o modal Partners bid / Internal, que cria a quote e leva
 * o card para Quoting. Contato que já tem card aberto: abre o dele.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getLead } from "@/services/leads";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { useStageLabels } from "./use-stage-labels";
import { LeadQuotingModal } from "./lead-quoting-modal";
import { crmLeadHref } from "./crm-lead-chip";
import { textareaClass } from "./crm-ui";
import type { CatalogService, Lead, LeadSegment, LeadStage } from "@/types/database";

export type AddToCrmPrefill = {
  name: string;
  email?: string | null;
  phone?: string | null;
  postcode?: string | null;
  address?: string | null;
  scope?: string | null;
  clientId?: string | null;
  accountId?: string | null;
  ticketId?: string | null;
  segment?: LeadSegment;
};

export type LeadCriado = { id: string; reference: string | null; stage: LeadStage };

const COLUNAS: { stage: LeadStage; text: string }[] = [
  { stage: "new", text: "Just arrived. Nobody has qualified it yet." },
  { stage: "qualifying", text: "We are gathering the details." },
  { stage: "qualified", text: "Details complete. The closer's turn." },
  { stage: "quoting", text: "Needs a price. Next: partners bid or internal quote." },
];

export function AddToCrmModal({
  open,
  onClose,
  prefill,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  prefill: AddToCrmPrefill;
  onDone: (lead: LeadCriado) => void;
}) {
  const labels = useStageLabels();
  const [stage, setStage] = useState<LeadStage>("new");
  const [segment, setSegment] = useState<LeadSegment>(prefill.segment ?? "b2c");
  const [name, setName] = useState(prefill.name);
  const [postcode, setPostcode] = useState(prefill.postcode ?? "");
  const [scope, setScope] = useState(prefill.scope ?? "");
  const [saving, setSaving] = useState(false);
  const [quoting, setQuoting] = useState<Lead | null>(null);
  const [catalog, setCatalog] = useState<CatalogService[]>([]);

  useEffect(() => {
    if (!open) return;
    setStage("new");
    setSegment(prefill.segment ?? "b2c");
    setName(prefill.name);
    setPostcode(prefill.postcode ?? "");
    setScope(prefill.scope ?? "");
    // Só quando abre: a caixa recarrega a cada 10 s e não pode apagar o que a pessoa digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (stage !== "quoting" || catalog.length) return;
    listCatalogServicesForPicker()
      .then(setCatalog)
      .catch(() => undefined);
  }, [stage, catalog.length]);

  const submit = async () => {
    if (name.trim().length < 2) return toast.error("Add the customer's name");
    setSaving(true);
    try {
      const res = await fetch("/api/crm/leads/from-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Quoting: nasce em Qualified e o modal de quote leva para Quoting.
          stage: stage === "quoting" ? "qualified" : stage,
          segment,
          name: name.trim(),
          email: prefill.email ?? null,
          phone: prefill.phone ?? null,
          postcode: postcode.trim() || null,
          address: prefill.address ?? null,
          scope: scope.trim(),
          clientId: prefill.clientId ?? null,
          accountId: prefill.accountId ?? null,
          ticketId: prefill.ticketId ?? null,
        }),
      });
      const j = (await res.json().catch(() => null)) as { lead?: LeadCriado; existed?: boolean; error?: string } | null;
      if (!res.ok || !j?.lead) throw new Error(j?.error ?? "Could not add to the CRM");
      const lead = j.lead;
      if (j.existed) {
        toast.info(`${lead.reference ?? "This contact"} is already in the CRM (${labels[lead.stage] ?? lead.stage}).`, {
          action: { label: "Open", onClick: () => window.location.assign(crmLeadHref(lead.id)) },
        });
        onDone(lead);
        onClose();
        return;
      }
      if (stage === "quoting") {
        const full = await getLead(lead.id);
        if (full) {
          setQuoting(full);
          return;
        }
      }
      toast.success(`${lead.reference ?? "Lead"} added to ${labels[lead.stage] ?? lead.stage}`, {
        action: { label: "Open", onClick: () => window.location.assign(crmLeadHref(lead.id)) },
      });
      onDone(lead);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to the CRM");
    } finally {
      setSaving(false);
    }
  };

  if (quoting) {
    return (
      <LeadQuotingModal
        lead={quoting}
        catalog={catalog}
        open
        onClose={() => {
          // Desistiu da quote: o card fica em Qualified.
          toast.info(`${quoting.reference} is in ${labels.qualified}. Move it to ${labels.quoting} when the price is coming.`);
          onDone({ id: quoting.id, reference: quoting.reference, stage: "qualified" });
          setQuoting(null);
          onClose();
        }}
        onDone={() => {
          onDone({ id: quoting.id, reference: quoting.reference, stage: "quoting" });
          setQuoting(null);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Add to CRM" subtitle="Pick the column for this card." size="sm">
      <div className="space-y-3 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {COLUNAS.map((c) => (
            <button
              key={c.stage}
              type="button"
              onClick={() => setStage(c.stage)}
              aria-pressed={stage === c.stage}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                stage === c.stage ? "border-primary bg-primary-light ring-2 ring-primary/15" : "border-border-light hover:border-border",
              )}
            >
              <span className="block text-sm font-semibold text-text-primary">{labels[c.stage]}</span>
              <span className="block text-xs text-text-secondary">{c.text}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">Segment</span>
          {(["b2c", "b2b"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              aria-pressed={segment === s}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-semibold uppercase",
                segment === s ? "bg-primary text-white" : "border border-border-light text-text-secondary hover:border-border",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">Postcode</span>
            <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="W5 2AB" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">What they need</span>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={3}
            placeholder="Short scope. No prices."
            className={textareaClass}
          />
        </label>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          {prefill.ticketId ? (
            <span className="text-[11px] text-text-tertiary">Linked to Zendesk #{prefill.ticketId}</span>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : stage === "quoting" ? "Next: the quote" : `Add to ${labels[stage]}`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

