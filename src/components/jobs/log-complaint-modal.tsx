"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/**
 * Log complaint (15/10/2026): um passo só para a reclamação do cliente.
 * Por baixo é o mesmo "Put on hold" com o motivo Complaint (pausa o job e o
 * pagamento, avisa o parceiro por e-mail com o link do journal no portal); as
 * fotos do cliente entram no journal da reclamação.
 */
export function LogComplaintModal({
  open,
  reference,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  reference: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: (input: { description: string; photos: File[]; partnerSeesPhotos: boolean }) => void;
}) {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [partnerSeesPhotos, setPartnerSeesPhotos] = useState(true);

  useEffect(() => {
    if (!open) {
      setDescription("");
      setPhotos([]);
      setPartnerSeesPhotos(true);
    }
  }, [open]);

  const ready = description.trim().length > 0 && !saving;

  return (
    <Modal open={open} onClose={() => !saving && onClose()} title="Log complaint" subtitle={reference} size="md">
      <div className="space-y-3 p-4 text-[12px]">
        <p className="m-0 text-text-secondary">
          The job goes on hold and the payment pauses. The partner gets an email that opens the complaint journal in the
          partner portal.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">What did the client say? *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            autoFocus
            placeholder="The partner sees this in the email and in the journal."
            className="min-h-[88px] w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-border px-3 text-xs font-medium text-text-primary hover:bg-surface-hover">
            {photos.length ? `Photos (${photos.length})` : "Add photos from the client"}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])].slice(0, 10))}
            />
          </label>
          {photos.length > 0 ? (
            <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={partnerSeesPhotos} onChange={(e) => setPartnerSeesPhotos(e.target.checked)} />
              Partner sees the photos
            </label>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            Back
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={saving}
            disabled={!ready}
            onClick={() => onConfirm({ description: description.trim(), photos, partnerSeesPhotos })}
          >
            Log complaint
          </Button>
        </div>
      </div>
    </Modal>
  );
}
