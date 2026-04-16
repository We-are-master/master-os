"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, Loader2, X } from "lucide-react";
import { compressImage, sanitizeFileForUpload } from "@/lib/upload-helpers";
import { TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";

const MAX_IMAGES = 6;

interface NewRequestModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal form for creating a new service request from the portal.
 *
 * Replaces the old standalone `/portal/requests/new` page so the user
 * never loses scroll context on the list. Same fields, same submit
 * endpoint (`POST /api/portal/requests`) — just mounted inside a
 * centred, animated dialog instead of its own route.
 *
 * Behaviour:
 *   - ESC key + click-on-backdrop close (unless submitting)
 *   - Success: router.refresh() so the list picks up the new row, then
 *     closes the modal
 *   - Failure: inline error message, no navigation
 *   - Restores body scroll lock on unmount
 */
export function NewRequestModal({ open, onClose }: NewRequestModalProps) {
  const router = useRouter();
  const [serviceType, setServiceType]       = useState("");
  const [description, setDescription]       = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [desiredDate, setDesiredDate]       = useState("");
  const [images, setImages]                 = useState<File[]>([]);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form when the modal opens
  useEffect(() => {
    if (open) {
      setServiceType("");
      setDescription("");
      setPropertyAddress("");
      setDesiredDate("");
      setImages([]);
      setError(null);
    }
  }, [open]);

  // ESC to close (unless in flight) + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, submitting, onClose]);

  function handleAddImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_IMAGES - images.length;
    setImages((prev) => [...prev, ...files.slice(0, remaining)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!serviceType.trim())     { setError("Please pick a service type."); return; }
    if (!description.trim())     { setError("Please describe what you need."); return; }
    if (!propertyAddress.trim()) { setError("Please enter the property address."); return; }

    setSubmitting(true);
    try {
      const compressed = await Promise.all(images.map((f) => compressImage(f)));

      const form = new FormData();
      form.append("serviceType", serviceType.trim());
      form.append("description", description.trim());
      form.append("propertyAddress", propertyAddress.trim());
      if (desiredDate.trim()) form.append("desiredDate", desiredDate.trim());
      compressed.forEach((file, idx) => {
        form.append("images", sanitizeFileForUpload(file, `image_${idx + 1}`));
      });

      const res = await fetch("/api/portal/requests", {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
      });
      let payload: { ok?: boolean; error?: unknown } = {};
      try { payload = await res.json(); } catch { /* ignore */ }

      if (!res.ok) {
        const apiErr = typeof payload.error === "string" ? payload.error : "";
        setError(apiErr || "We could not submit your request. Please try again.");
        setSubmitting(false);
        return;
      }

      router.refresh();
      onClose();
      setSubmitting(false);
    } catch (err) {
      console.error("[portal/requests/new-modal] submit error:", err);
      setError("We could not submit your request. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !submitting && onClose()}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New service request"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative w-full max-w-2xl max-h-[90vh] rounded-2xl bg-card shadow-2xl border border-border overflow-hidden flex flex-col"
          >
            <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border-light">
              <div>
                <h2 className="text-lg font-bold text-text-primary">New service request</h2>
                <p className="text-xs text-text-tertiary mt-0.5">
                  Tell us what you need and our team will respond with a quote.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
                className="p-2 -m-2 rounded-lg hover:bg-surface-hover text-text-tertiary disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {error && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Service type <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">Select a type of work...</option>
                  {TYPE_OF_WORK_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                  rows={5}
                  placeholder="Tell us what needs doing — the more detail you give, the faster we can quote."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Property address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder="123 Example Street, London, SW1A 1AA"
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Desired date <span className="text-text-tertiary font-normal normal-case">(optional)</span>
                </label>
                <input
                  type="date"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  value={desiredDate}
                  onChange={(e) => setDesiredDate(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Photos <span className="text-text-tertiary font-normal normal-case">(optional, up to {MAX_IMAGES})</span>
                </label>

                {images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {images.map((file, idx) => {
                      const url = URL.createObjectURL(file);
                      return (
                        <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`upload-${idx}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-slate-900"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {images.length < MAX_IMAGES && (
                  <label className="flex items-center justify-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed border-border bg-surface-secondary hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors">
                    <ImagePlus className="w-5 h-5 text-text-tertiary" />
                    <span className="text-sm font-semibold text-text-secondary">
                      {images.length === 0 ? "Add photos" : "Add more"}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      multiple
                      onChange={handleAddImages}
                      disabled={submitting}
                    />
                  </label>
                )}
              </div>
            </form>

            <footer className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border-light bg-surface-secondary/50">
              <button
                type="button"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                onClick={handleSubmit}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white bg-primary hover:bg-primary-hover transition-colors shadow-sm shadow-primary/20 disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? "Submitting..." : "Submit request"}
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
