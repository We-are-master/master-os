"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { assignPartnerToJob, jobPricesHourly } from "@/lib/assign-partner-to-job";
import { listAssignablePartners, type AssignablePartner } from "@/services/partners";
import { getJob } from "@/services/jobs";
import type { Job } from "@/types/database";

type Props = {
  jobId: string;
  jobReference?: string;
  isOpen: boolean;
  onClose: () => void;
  onAssigned?: (updated: Job) => void;
};

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n);

/**
 * Assign a partner without leaving the board. Same process as the Jobs detail
 * modal (it calls the shared `assignPartnerToJob`), narrowed to what the office
 * decides at this point: who goes, what we pay, what the client pays.
 */
export function AssignPartnerModal({ jobId, jobReference, isOpen, onClose, onAssigned }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [partners, setPartners] = useState<AssignablePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [partnerCost, setPartnerCost] = useState("");
  const [clientPrice, setClientPrice] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [row, list] = await Promise.all([getJob(jobId), listAssignablePartners()]);
      if (cancelled) return;
      setJob(row);
      setPartners(list);
      setSelectedId(row?.partner_id ?? "");
      setPartnerCost(row && Number(row.partner_cost) > 0 ? String(Number(row.partner_cost)) : "");
      setClientPrice(row && Number(row.client_price) > 0 ? String(Number(row.client_price)) : "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, jobId]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedId("");
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      [p.company_name, p.contact_name, p.trade].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [partners, search]);

  const hourly = job ? jobPricesHourly(job) : false;
  const costValue = Math.max(0, Number(partnerCost) || 0);
  const priceValue = Math.max(0, Number(clientPrice) || 0);
  const marginPct = priceValue > 0 && costValue > 0 ? Math.round(((priceValue - costValue) / priceValue) * 100) : null;
  const selected = partners.find((p) => p.id === selectedId) ?? null;
  // Zero is allowed: a return visit to finish paid work is worth nothing new.
  // Picking the partner is the whole decision here.
  const canConfirm = !!job && !!selected && !saving;

  const confirm = async () => {
    if (!job || !selected) return;
    setSaving(true);
    try {
      const updated = await assignPartnerToJob(job, {
        partnerId: selected.id,
        partnerName: selected.company_name?.trim() || selected.contact_name || "Partner",
        partnerCost: costValue,
        clientPrice: priceValue,
      });
      toast.success(
        hourly
          ? `${updated.partner_name} assigned`
          : `${updated.partner_name} assigned · ${gbp(costValue)} partner cost`,
      );
      onAssigned?.(updated);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign partner");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Assign partner" subtitle={jobReference} size="md">
      <div className="space-y-4 p-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-text-tertiary">Loading…</p>
        ) : !job ? (
          <p className="py-8 text-center text-sm text-text-tertiary">Job not found.</p>
        ) : (
          <>
            <div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search active partners…"
                icon={<Search className="h-3.5 w-3.5" />}
                aria-label="Search partners"
                autoComplete="off"
              />
              <div className="mt-2 max-h-[240px] overflow-y-auto overscroll-contain rounded-lg border border-border-light">
                {filtered.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-text-tertiary">
                    {search.trim() ? "No active partner matches your search." : "No active partners."}
                  </p>
                ) : (
                  filtered.map((p) => {
                    const name = p.company_name?.trim() || p.contact_name || "Partner";
                    const isSel = selectedId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover",
                          isSel && "bg-primary/8",
                        )}
                      >
                        <Avatar name={name} src={p.avatar_url} size="sm" className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-text-primary">{name}</p>
                          <p className="truncate text-[11px] text-text-tertiary">{p.trade || "Partner"}</p>
                        </div>
                        {isSel ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {hourly ? (
              <p className="rounded-lg border border-border-light bg-surface-hover px-3 py-2.5 text-[12px] leading-snug text-text-secondary">
                This job is priced hourly from the catalog. Assigning here keeps the rates as they are. Open the job to
                change hours or rates.
              </p>
            ) : (
              <div className="space-y-2 border-t border-border-light pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Rate &amp; cost</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>Partner cost £</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={partnerCost}
                      onChange={(e) => setPartnerCost(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-secondary">
                    <span>Client price £</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={clientPrice}
                      onChange={(e) => setClientPrice(e.target.value)}
                    />
                  </label>
                </div>
                <p className="text-right text-sm font-semibold text-text-primary">
                  Margin: {marginPct == null ? "—" : `${marginPct}%`}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={saving} disabled={!canConfirm} onClick={() => void confirm()}>
                Assign &amp; confirm
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
