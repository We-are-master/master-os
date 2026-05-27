"use client";

// Read-only staff view of which partners responded to a lead (service_request) in the Trade
// Portal: who contacted (or declined). Fetches /api/requests/[id]/offers. Hidden until there's
// at least one response.

import { useEffect, useState } from "react";
import { Phone, Loader2 } from "lucide-react";

interface Offer {
  id: string;
  partnerId: string;
  partnerName: string;
  status: string;
  contactedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  contacted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  declined: "bg-red-50 text-red-700 border-red-200",
  offered: "bg-surface text-text-secondary border-border-light",
  viewed: "bg-blue-50 text-blue-700 border-blue-200",
};

export function RequestOffersCard({ requestId }: { requestId: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/requests/${requestId}/offers`);
        const json = await res.json();
        if (!cancelled && res.ok) setOffers(json.offers ?? []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border-light bg-surface p-4 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading partner responses…
      </div>
    );
  }
  if (offers.length === 0) return null;

  const contacted = offers.filter((o) => o.status === "contacted").length;

  return (
    <div className="rounded-xl border border-border-light bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Partner responses</h3>
        <span className="text-xs text-text-tertiary">{contacted} contacted</span>
      </div>
      <ul className="space-y-1.5">
        {offers.map((o) => (
          <li key={o.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-text-primary truncate">{o.partnerName}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[o.status] ?? STATUS_STYLE.offered}`}>
              {o.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
