"use client";

import { useEffect, useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { getCampaign } from "@/services/outreach";
import { format } from "date-fns";
import type { OutreachCampaign, OutreachCampaignRecipient, OutreachRecipientStatus } from "@/types/outreach";

interface HistoryDetailModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string | null;
}

const STATUS_VARIANT: Record<OutreachRecipientStatus, "success" | "warning" | "danger" | "info" | "default"> = {
  queued: "default",
  sent: "info",
  delivered: "success",
  opened: "success",
  bounced: "warning",
  failed: "danger",
};

const STATUS_LABEL: Record<OutreachRecipientStatus, string> = {
  queued: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  opened: "Aberto",
  bounced: "Bounce",
  failed: "Falhou",
};

export function HistoryDetailModal({ open, onClose, campaignId }: HistoryDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null);
  const [recipients, setRecipients] = useState<OutreachCampaignRecipient[]>([]);
  const [showBody, setShowBody] = useState(false);

  const fetchCampaign = useCallback(async (id: string) => {
    setLoading(true);
    setShowBody(false);
    try {
      const data = await getCampaign(id);
      setCampaign(data.campaign);
      setRecipients(data.recipients);
    } catch {
      setCampaign(null);
      setRecipients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !campaignId) return;
    void fetchCampaign(campaignId);
  }, [open, campaignId, fetchCampaign]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={campaign?.subject ?? "Detalhes da campanha"}
      subtitle={
        campaign
          ? `Enviada em ${format(new Date(campaign.sent_at), "dd/MM/yyyy HH:mm")} por ${campaign.sent_by_name ?? "—"}`
          : undefined
      }
      size="lg"
    >
      <div className="p-4 sm:p-6 space-y-4">
        {loading && <p className="text-xs text-text-tertiary">Carregando...</p>}
        {!loading && campaign && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Destinatários" value={campaign.recipient_count} />
              <Stat label="Entregues" value={campaign.delivered_count} />
              <Stat label="Abertos" value={campaign.opened_count} />
              <Stat label="Falhas" value={campaign.failed_count} accent={campaign.failed_count > 0 ? "danger" : undefined} />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowBody((s) => !s)}
                className="text-xs text-primary hover:underline"
              >
                {showBody ? "Ocultar corpo do e-mail" : "Ver corpo do e-mail"}
              </button>
              {showBody && (
                <div className="mt-2 rounded-lg border border-border-light bg-white text-stone-900 overflow-hidden">
                  <div
                    className="prose prose-sm max-w-none p-4"
                    dangerouslySetInnerHTML={{ __html: campaign.body_html }}
                  />
                </div>
              )}
            </div>

            <div>
              <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                Destinatários ({recipients.length})
              </div>
              <div className="rounded-lg border border-border-light overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-secondary sticky top-0">
                      <tr className="text-left text-text-tertiary">
                        <th className="px-3 py-2 font-medium">Destinatário</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Resend ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.map((r) => (
                        <tr key={r.id} className="border-t border-border-light">
                          <td className="px-3 py-2">
                            <div className="text-text-primary">{r.email}</div>
                            {r.name && <div className="text-text-tertiary">{r.name}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                              {STATUS_LABEL[r.status]}
                            </Badge>
                            {r.error_message && (
                              <div className="text-[10px] text-red-500 mt-1 truncate max-w-[200px]">
                                {r.error_message}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-text-tertiary truncate max-w-[120px]">
                            {r.resend_message_id ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "danger" }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary/40 p-3">
      <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-xl font-semibold mt-0.5 ${accent === "danger" ? "text-red-600" : "text-text-primary"}`}>
        {value}
      </div>
    </div>
  );
}
