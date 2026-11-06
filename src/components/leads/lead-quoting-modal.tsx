"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServiceCatalogSelect } from "@/components/ui/service-catalog-select";
import { cn } from "@/lib/utils";
import {
  accountSkipsDeposit,
  createQuoteFromLead,
  sendQuoteToPartners,
  updateLeadJobFields,
  type QuoteMode,
} from "@/services/crm-leads";
import type { CatalogService, Lead } from "@/types/database";

/**
 * Mover o card para Quoting pergunta como o preço vai sair:
 * - Partners bid: a quote nasce em bidding e vai para todos os parceiros do
 *   trade na área (push, e-mail e convite). O card fica em Quoting com o chip
 *   Sourcing; quando um parceiro cota, vira Ready to send.
 * - Internal: a quote nasce em draft e abre na tela de Quotes para a equipe
 *   pôr o preço.
 * Bid pede tipo de trabalho e postcode (o casamento é por trade e área).
 */
export function LeadQuotingModal({
  lead,
  catalog,
  open,
  onClose,
  onDone,
}: {
  lead: Lead;
  catalog: CatalogService[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<QuoteMode>("bid");
  const [serviceId, setServiceId] = useState(lead.catalog_service_id ?? "");
  const [postcode, setPostcode] = useState(lead.postcode ?? "");
  const [saving, setSaving] = useState(false);

  const serviceName = catalog.find((c) => c.id === serviceId)?.name ?? null;
  const faltaParaBid = !serviceId ? "Pick the type of work" : !postcode.trim() ? "Add the postcode" : null;

  const submit = async () => {
    if (mode === "bid" && faltaParaBid) return toast.error(`${faltaParaBid} so partners can be matched`);
    setSaving(true);
    try {
      let current = lead;
      const patch: { catalog_service_id?: string | null; postcode?: string | null } = {};
      if (serviceId && serviceId !== lead.catalog_service_id) patch.catalog_service_id = serviceId;
      if (postcode.trim() && postcode.trim() !== (lead.postcode ?? "")) patch.postcode = postcode.trim().toUpperCase();
      if (Object.keys(patch).length) current = await updateLeadJobFields(lead.id, patch);

      const semEntrada = await accountSkipsDeposit(current.account_id);
      const quote = await createQuoteFromLead(current, {
        title: `${serviceName?.trim() || "Quote"} · ${current.name}`,
        semEntrada,
        mode,
      });

      if (mode === "bid") {
        try {
          const { partners } = await sendQuoteToPartners(quote.id);
          if (partners > 0) toast.success(`${quote.reference} sent to ${partners} partner${partners === 1 ? "" : "s"}. It shows Ready to send when one quotes.`);
          else toast.warning(`${quote.reference} is in bidding, but no partner matched this trade and area. Invite partners from the quote.`);
        } catch (err) {
          toast.error(`${quote.reference} created, but sending to partners failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
        onDone();
      } else {
        toast.success(`${quote.reference} created. Add the price and send it.`);
        onDone();
        router.push(`/quotes?quoteId=${quote.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the quote");
    } finally {
      setSaving(false);
    }
  };

  const Option = ({ value, icon: Icon, title, text }: { value: QuoteMode; icon: typeof Users; title: string; text: string }) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
        mode === value
          ? value === "bid"
            ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200 dark:bg-amber-950/30"
            : "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200 dark:bg-indigo-950/30"
          : "border-border-light hover:border-border",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          value === "bid" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span>
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span className="block text-xs text-text-secondary">{text}</span>
      </span>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Move to Quoting" subtitle={`${lead.reference} · ${lead.name}. How is the price coming?`} size="sm">
      <div className="space-y-3 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        <Option
          value="bid"
          icon={Users}
          title="Partners bid"
          text="Sends it to every partner of this trade in the area. Ready to send as soon as one quotes."
        />
        <Option value="internal" icon={Calculator} title="Internal quote" text="We price it ourselves. Opens the quote to add the lines and send." />

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <ServiceCatalogSelect
            label="Type of work"
            emptyOptionLabel="Pick one…"
            nameOnlyLabels
            catalog={catalog}
            value={serviceId}
            onChange={(id) => setServiceId(id)}
          />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">Postcode</span>
            <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="W5 2AB" />
          </label>
        </div>
        {mode === "bid" && faltaParaBid ? <p className="text-xs text-[var(--warn-ink)]">{faltaParaBid} to match partners.</p> : null}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || (mode === "bid" && !!faltaParaBid)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "bid" ? "Send to partners" : "Create quote"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
