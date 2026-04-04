"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, FileText, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import type { InvoiceStatus, Job, Quote } from "@/types/database";
import type { CreateInvoiceInput } from "@/services/invoices";
import { getClient } from "@/services/clients";
import { listJobs } from "@/services/jobs";
import { listQuotes } from "@/services/quotes";
import { getInvoiceDueDateIsoForJobReference } from "@/services/invoice-due-date";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";
import {
  ClientAddressPicker,
  type ClientAndAddressValue,
} from "@/components/ui/client-address-picker";

type RefHit = { kind: "job"; job: Job } | { kind: "quote"; quote: Quote };

const emptyClientPick = (): ClientAndAddressValue => ({
  client_name: "",
  property_address: "",
});

export function CreateInvoiceModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateInvoiceInput) => void | Promise<void>;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    job_reference: "",
    amount: "",
    due_date: "",
    status: "pending" as InvoiceStatus,
  });
  const [clientPick, setClientPick] = useState<ClientAndAddressValue>(emptyClientPick);
  const [submitting, setSubmitting] = useState(false);

  const [refSearch, setRefSearch] = useState("");
  const [refOpen, setRefOpen] = useState(false);
  const [refLoading, setRefLoading] = useState(false);
  const [refHits, setRefHits] = useState<RefHit[]>([]);
  const [pendingQuote, setPendingQuote] = useState<Quote | null>(null);

  const refBoxRef = useRef<HTMLDivElement>(null);
  const refDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    setForm({
      job_reference: "",
      amount: "",
      due_date: dueDateIsoFromPaymentTerms(new Date(), null),
      status: "pending",
    });
    setClientPick(emptyClientPick());
    setRefSearch("");
    setRefOpen(false);
    setRefHits([]);
    setPendingQuote(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      if (refBoxRef.current && !refBoxRef.current.contains(t)) setRefOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const loadRefHits = useCallback(async (q: string) => {
    setRefLoading(true);
    try {
      const s = q.trim();
      const [jobsRes, quotesRes] = await Promise.all([
        listJobs({ search: s || undefined, page: 1, pageSize: s ? 16 : 12, status: "all" }),
        listQuotes({ search: s || undefined, page: 1, pageSize: s ? 16 : 12 }),
      ]);
      const hits: RefHit[] = [
        ...jobsRes.data.map((job) => ({ kind: "job" as const, job })),
        ...quotesRes.data.map((quote) => ({ kind: "quote" as const, quote })),
      ];
      setRefHits(hits);
    } catch {
      setRefHits([]);
    } finally {
      setRefLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !refOpen) return;
    if (refDebounce.current) clearTimeout(refDebounce.current);
    refDebounce.current = setTimeout(() => {
      void loadRefHits(refSearch);
    }, 200);
    return () => {
      if (refDebounce.current) clearTimeout(refDebounce.current);
    };
  }, [open, refOpen, refSearch, loadRefHits]);

  const pickJob = useCallback(async (job: Job) => {
    setPendingQuote(null);
    setRefSearch(job.reference);
    setRefOpen(false);
    setRefHits([]);

    const due = await getInvoiceDueDateIsoForJobReference(job.reference);
    const total = Math.round((Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0)) * 100) / 100;

    setForm((prev) => {
      const next = { ...prev, job_reference: job.reference };
      const amt = prev.amount.trim();
      const amtNum = Number(amt);
      if (total > 0 && (amt === "" || !Number.isFinite(amtNum) || amtNum === 0)) {
        next.amount = String(total);
      }
      if (due) next.due_date = due;
      return next;
    });

    if (job.client_id?.trim()) {
      const c = await getClient(job.client_id);
      if (c) {
        setClientPick({
          client_id: c.id,
          client_name: c.full_name,
          client_email: c.email ?? undefined,
          client_address_id: job.client_address_id?.trim() || undefined,
          property_address: job.property_address || "",
        });
      } else {
        setClientPick({
          client_id: undefined,
          client_name: job.client_name,
          property_address: job.property_address || "",
        });
      }
    } else {
      setClientPick({
        client_id: undefined,
        client_name: job.client_name,
        property_address: job.property_address || "",
      });
    }
  }, []);

  const pickQuote = useCallback(async (quote: Quote) => {
    setPendingQuote(quote);
    setRefSearch(quote.reference);
    setRefOpen(false);
    setRefHits([]);
    setForm((prev) => ({ ...prev, job_reference: "" }));

    if (quote.client_id?.trim()) {
      const c = await getClient(quote.client_id);
      if (c) {
        setClientPick({
          client_id: c.id,
          client_name: c.full_name,
          client_email: c.email ?? undefined,
          client_address_id: quote.client_address_id?.trim() || undefined,
          property_address: quote.property_address?.trim() || "",
        });
      } else {
        setClientPick({
          client_id: undefined,
          client_name: quote.client_name,
          property_address: quote.property_address?.trim() || "",
        });
      }
    } else {
      setClientPick({
        client_id: undefined,
        client_name: quote.client_name,
        property_address: quote.property_address?.trim() || "",
      });
    }
  }, []);

  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingQuote) {
      toast.error("Convert the quote to a job first, then create the invoice from that job.");
      return;
    }
    if (!clientPick.client_id?.trim()) {
      toast.error("Choose a client from the list, then select a property address.");
      return;
    }
    if (!clientPick.client_address_id?.trim() && !clientPick.property_address?.trim()) {
      toast.error("Select a saved property address or add one for this client.");
      return;
    }
    if (!form.amount || !form.due_date) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      const row = await getClient(clientPick.client_id);
      await onCreate({
        client_name: clientPick.client_name.trim(),
        job_reference: form.job_reference.trim() || undefined,
        source_account_id: row?.source_account_id?.trim() || undefined,
        amount: Number(form.amount),
        due_date: form.due_date,
        status: form.status,
      });
      reset();
    } finally {
      setSubmitting(false);
    }
  };

  const openQuoteToConvert = () => {
    if (!pendingQuote) return;
    onClose();
    router.push(`/quotes?quoteId=${encodeURIComponent(pendingQuote.id)}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Invoice" subtitle="Add a new client invoice" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="space-y-1">
          <ClientAddressPicker
            value={clientPick}
            onChange={setClientPick}
            labelClient="Client *"
            labelAddress="Property address *"
            required
            loadAllClientsOnOpen
            className="space-y-1"
          />
          <p className="text-[11px] text-text-tertiary leading-snug">
            Open the client field to browse everyone, or search by name, email, or address. Then pick the site address for this
            invoice.
          </p>
        </div>

        <div ref={refBoxRef} className="relative space-y-1.5">
          <label className="block text-xs font-medium text-text-secondary">Job or quote reference</label>
          <p className="text-[11px] text-text-tertiary -mt-0.5 leading-snug">
            Search jobs and quotes by reference, title, or client. Jobs link this invoice and set due date from the linked
            account when possible.
          </p>
          <div className="relative">
            <Input
              value={refSearch}
              onChange={(e) => {
                const v = e.target.value;
                setRefSearch(v);
                setForm((prev) => ({ ...prev, job_reference: v }));
                setPendingQuote(null);
                setRefOpen(true);
              }}
              onBlur={async () => {
                const ref = refSearch.trim();
                if (!ref || pendingQuote) return;
                const due = await getInvoiceDueDateIsoForJobReference(ref);
                if (due) setForm((prev) => ({ ...prev, due_date: due }));
              }}
              onFocus={() => {
                setRefOpen(true);
              }}
              placeholder="e.g. JOB-2024-0001 or QT-…"
              autoComplete="off"
              className="pr-9"
            />
            {refLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-text-tertiary" />
            )}
            {refOpen && (
              <div className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg py-1">
                {!refSearch.trim() && !refLoading ? (
                  <p className="px-3 py-2 text-xs text-text-tertiary">Recent jobs and quotes — type to filter.</p>
                ) : null}
                {refHits.length === 0 && !refLoading ? (
                  <p className="px-3 py-2 text-xs text-text-tertiary">No jobs or quotes match.</p>
                ) : (
                  refHits.map((hit) =>
                    hit.kind === "job" ? (
                      <button
                        key={`j-${hit.job.id}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-start gap-2"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void pickJob(hit.job)}
                      >
                        <Briefcase className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Job</p>
                          <p className="text-sm font-medium text-text-primary font-mono">{hit.job.reference}</p>
                          <p className="text-[11px] text-text-secondary truncate">{hit.job.title}</p>
                          <p className="text-[10px] text-text-tertiary truncate">{hit.job.client_name}</p>
                        </div>
                      </button>
                    ) : (
                      <button
                        key={`q-${hit.quote.id}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-start gap-2"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void pickQuote(hit.quote)}
                      >
                        <FileText className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Quote</p>
                          <p className="text-sm font-medium text-text-primary font-mono">{hit.quote.reference}</p>
                          <p className="text-[11px] text-text-secondary truncate">{hit.quote.title}</p>
                          <p className="text-[10px] text-text-tertiary truncate">{hit.quote.client_name}</p>
                        </div>
                      </button>
                    ),
                  )
                )}
              </div>
            )}
          </div>
          {form.job_reference.trim() && !pendingQuote ? (
            <p className="text-[11px] text-text-tertiary">
              Linked job <span className="font-mono text-text-secondary">{form.job_reference.trim()}</span>. Due date uses the
              client&apos;s account payment terms when available.
            </p>
          ) : null}
        </div>

        {pendingQuote ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-text-primary">This reference is a quote</p>
            <p className="text-xs text-text-secondary leading-relaxed">
              Invoices are tied to jobs. Convert quote <span className="font-mono font-medium">{pendingQuote.reference}</span>{" "}
              to a job first, then create the invoice using that job reference.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" onClick={openQuoteToConvert}>
                Convert to invoice
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setPendingQuote(null);
                  setRefSearch("");
                  setForm((prev) => ({ ...prev, job_reference: "" }));
                }}
              >
                Clear quote
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount *</label>
            <Input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Due Date *</label>
            <Input type="date" value={form.due_date} onChange={(e) => update("due_date", e.target.value)} required />
          </div>
        </div>
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => update("status", e.target.value)}
          options={[
            { value: "pending", label: "Pending" },
            { value: "paid", label: "Paid" },
            { value: "overdue", label: "Overdue" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !!pendingQuote}>
            {submitting ? "Creating..." : "Create Invoice"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
