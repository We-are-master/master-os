"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, ClipboardList } from "lucide-react";
import { NewRequestModal } from "./new-request-modal";
import { PortalPage, PortalStagger, PortalListItem } from "@/components/portal/portal-motion";

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  new:                { label: "New",          chip: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",           dot: "bg-sky-500" },
  in_review:          { label: "In review",    chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",   dot: "bg-amber-500" },
  qualified:          { label: "Qualified",    chip: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300", dot: "bg-violet-500" },
  converted_to_quote: { label: "Quote sent",   chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
  converted_to_job:   { label: "Job created",  chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
  declined:           { label: "Declined",     chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",     dot: "bg-stone-400" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export interface PortalRequestRow {
  id: string;
  reference: string;
  service_type: string;
  status: string;
  property_address: string | null;
  owner_name: string | null;
  created_at: string;
}

export function RequestsClient({ requests }: { requests: PortalRequestRow[] }) {
  const searchParams = useSearchParams();
  const autoOpen = searchParams?.get("new") === "1";
  const [modalOpen, setModalOpen] = useState(autoOpen);

  return (
    <PortalPage className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-text-primary tracking-tight">Service requests</h1>
          <p className="text-sm text-text-secondary mt-1">
            Open new requests and track their status as the Master team responds.
          </p>
        </div>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors shadow-sm shadow-primary/20"
        >
          <Plus className="w-4 h-4" />
          New request
        </motion.button>
      </div>

      {requests.length === 0 ? (
        <EmptyState onNew={() => setModalOpen(true)} />
      ) : (
        <PortalStagger className="space-y-2">
          {requests.map((r) => {
            const style = STATUS_STYLE[r.status] ?? { label: r.status.replace(/_/g, " "), chip: "bg-surface-tertiary text-text-secondary", dot: "bg-stone-400" };
            return (
              <PortalListItem key={r.id}>
                <div className="rounded-2xl border border-border bg-card p-4 flex items-start justify-between gap-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-border-light">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[11px] font-mono text-text-tertiary tracking-wider">{r.reference}</span>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-text-primary truncate">{r.service_type}</p>
                    {r.property_address && (
                      <p className="text-xs text-text-secondary truncate mt-0.5">{r.property_address}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-text-tertiary">{fmtDate(r.created_at)}</p>
                    {r.owner_name && (
                      <p className="text-xs text-text-secondary mt-0.5">Handled by {r.owner_name}</p>
                    )}
                  </div>
                </div>
              </PortalListItem>
            );
          })}
        </PortalStagger>
      )}

      <NewRequestModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </PortalPage>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card text-center py-20 px-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-4">
        <ClipboardList className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-lg font-bold text-text-primary mb-1">No requests yet</h2>
      <p className="text-sm text-text-secondary mb-5 max-w-sm mx-auto">
        Tell us what you need and the Master team will respond with a tailored quote.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors"
      >
        <Plus className="w-4 h-4" />
        Open your first request
      </button>
    </div>
  );
}
