"use client";

// Staff view of which partners showed interest in a published lead from the Trade Portal. Each row
// is a lead_partner_offers entry (partner pressed "Contact" in the portal). Fetches
// /api/leads/[id]/offers. Shows an empty hint while a lead has no responses yet.

import { useEffect, useState } from "react";
import { Phone, Mail, Loader2, Users } from "lucide-react";

interface Offer {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerPhone: string | null;
  partnerEmail: string | null;
  contactedAt: string | null;
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function LeadOffersCard({ leadId, published }: { leadId: string; published: boolean }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/offers`);
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
  }, [leadId]);

  return (
    <div className="rounded-xl border border-border-light bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Interested partners</h3>
        <span className="text-xs text-text-tertiary">{offers.length}</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading responses…
        </div>
      ) : offers.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          {published
            ? "No partner has contacted this lead yet. It's live in the Trade Portal — responses appear here."
            : "Publish this lead to offer it to partners. Once a partner reaches out from the Trade Portal, they show here."}
        </p>
      ) : (
        <ul className="space-y-2">
          {offers.map((o) => (
            <li key={o.id} className="flex items-start gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="text-text-primary truncate">{o.partnerName}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-tertiary">
                  {o.partnerPhone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {o.partnerPhone}
                    </span>
                  )}
                  {o.partnerEmail && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3" /> {o.partnerEmail}
                    </span>
                  )}
                </div>
              </div>
              {o.contactedAt && <span className="shrink-0 text-[11px] text-text-tertiary">{when(o.contactedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
