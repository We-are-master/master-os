"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Mail, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";

interface InvitedPartner {
  partnerId:     string;
  partnerName:   string;
  partnerEmail:  string | null;
  invitedAt:     string;
  lastInvitedAt: string;
  lastChannel:   string | null;
  bidUrl:        string;
  bidStatus:     string | null;
  bidAmount:     number | null;
  bidUpdatedAt:  string | null;
}

interface QuoteBidLinksModalProps {
  open:           boolean;
  onClose:        () => void;
  quoteId:        string;
  quoteReference: string;
}

export function QuoteBidLinksModal({ open, onClose, quoteId, quoteReference }: QuoteBidLinksModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InvitedPartner[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/quotes/${quoteId}/invited-partners`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError((body as { error?: string })?.error ?? "Could not load invited partners.");
          return;
        }
        setItems(((body as { invited?: InvitedPartner[] })?.invited) ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, quoteId]);

  const onCopy = useCallback(async (item: InvitedPartner) => {
    try {
      await navigator.clipboard.writeText(item.bidUrl);
      setCopiedId(item.partnerId);
      toast.success(`Link copied for ${item.partnerName}.`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt(`Copy link for ${item.partnerName}:`, item.bidUrl);
    }
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bid links"
      subtitle={`${quoteReference} · one link per invited partner`}
      size="lg"
    >
      <div className="px-1 pb-1 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[#6B6B70]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-[13px]">Loading invited partners…</span>
          </div>
        ) : error ? (
          <div className="rounded-md bg-[#FFF1EB] border border-[#F5CFB8] p-3 text-[12px] text-[#7A3D00]">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md p-4 text-center" style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}>
            <p className="text-[13px] font-medium" style={{ color: "#020040" }}>No invited partners yet.</p>
            <p className="text-[11px] mt-1" style={{ color: "#6B6B70" }}>
              Use “Invite more partners” to send the bid request. Each invited partner will appear here with their own unique link.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const hasBid = item.bidStatus != null;
            const isCopied = copiedId === item.partnerId;
            return (
              <div
                key={item.partnerId}
                className="rounded-[10px] p-3 space-y-2"
                style={{
                  background: hasBid ? "#F0FBF7" : "#FFFFFF",
                  border: `0.5px solid ${hasBid ? "#B5E3D1" : "#E4E4E8"}`,
                }}
              >
                <div className="flex items-start gap-2">
                  <UserCircle2 className="h-4 w-4 shrink-0 mt-[2px]" style={{ color: "#6B6B70" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "#020040" }}>
                      {item.partnerName}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      {item.partnerEmail ? (
                        <span className="text-[11px] inline-flex items-center gap-1" style={{ color: "#6B6B70" }}>
                          <Mail className="h-3 w-3" />
                          {item.partnerEmail}
                        </span>
                      ) : (
                        <span className="text-[11px]" style={{ color: "#ED4B00" }}>No email on file</span>
                      )}
                      <span className="text-[11px]" style={{ color: "#9A9AA0" }}>·</span>
                      <span className="text-[11px]" style={{ color: "#6B6B70" }}>
                        Invited {formatRelative(item.lastInvitedAt)}
                      </span>
                    </div>
                  </div>
                  {hasBid ? (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0"
                      style={{ background: "#E4F5EE", color: "#0F6E56" }}
                    >
                      {item.bidStatus === "approved" ? "Approved" : item.bidStatus === "rejected" ? "Rejected" : "Bid £" + (item.bidAmount ?? 0).toFixed(2)}
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0"
                      style={{ background: "#F1F1F3", color: "#6B6B70" }}
                    >
                      No bid yet
                    </span>
                  )}
                </div>

                <div
                  className="rounded-[6px] p-2 text-[11px] font-mono break-all select-all"
                  style={{ background: "#FAFAFB", color: "#020040", border: "0.5px solid #E4E4E8" }}
                >
                  {item.bidUrl}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onCopy(item)}
                    className="inline-flex items-center gap-1.5 rounded-[6px] bg-white px-[12px] py-[6px] text-[12px] font-medium cursor-pointer"
                    style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                  >
                    {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {isCopied ? "Copied" : "Copy link"}
                  </button>
                  <a
                    href={item.bidUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[6px] bg-white px-[12px] py-[6px] text-[12px] font-medium"
                    style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Preview
                  </a>
                  {item.partnerEmail ? (
                    <a
                      href={`mailto:${item.partnerEmail}?subject=${encodeURIComponent(`Bid invitation — ${quoteReference}`)}&body=${encodeURIComponent(`Hi ${item.partnerName},\n\nPlease submit your bid here:\n${item.bidUrl}`)}`}
                      className="inline-flex items-center gap-1.5 rounded-[6px] bg-white px-[12px] py-[6px] text-[12px] font-medium"
                      style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                    >
                      <Mail className="h-3 w-3" />
                      Email
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.round(h / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default QuoteBidLinksModal;
