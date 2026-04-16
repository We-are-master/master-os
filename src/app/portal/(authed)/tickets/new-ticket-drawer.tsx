"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, Loader2, X, Paperclip } from "lucide-react";
import { compressImage, sanitizeFileForUpload } from "@/lib/upload-helpers";

const TICKET_TYPES = [
  { value: "general",     label: "General" },
  { value: "billing",     label: "Billing" },
  { value: "job_related", label: "Job related" },
  { value: "complaint",   label: "Complaint" },
];
const PRIORITIES = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
  { value: "urgent", label: "Urgent" },
];
const MAX_ATTACHMENTS = 5;

export interface NewTicketDrawerJob { id: string; reference: string; title: string }

interface NewTicketDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: NewTicketDrawerJob[];
  /** Pre-select a job (e.g. when launched from a job detail page). */
  defaultJobId?: string;
}

/**
 * Slide-in-from-right drawer for creating a new ticket.
 *
 * Replaces the standalone /portal/tickets/new page so the user keeps
 * the list in view on the left. Success navigates to the new ticket's
 * detail page (where the chat thread lives).
 */
export function NewTicketDrawer({ open, onClose, jobs, defaultJobId }: NewTicketDrawerProps) {
  const router = useRouter();
  const [subject, setSubject]   = useState("");
  const [type, setType]         = useState("general");
  const [priority, setPriority] = useState("medium");
  const [body, setBody]         = useState("");
  const [jobId, setJobId]       = useState(defaultJobId ?? "");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setSubject("");
      setType("general");
      setPriority("medium");
      setBody("");
      setJobId(defaultJobId ?? "");
      setAttachments([]);
      setError(null);
    }
  }, [open, defaultJobId]);

  // ESC close + body scroll lock
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

  function handleAddFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    setAttachments((prev) => [...prev, ...files.slice(0, remaining)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim()) { setError("Subject is required."); return; }
    if (!body.trim())    { setError("Please describe your issue."); return; }

    setSubmitting(true);
    try {
      const compressed = await Promise.all(attachments.map((f) => compressImage(f)));

      const form = new FormData();
      form.append("subject", subject.trim());
      form.append("type", type);
      form.append("priority", priority);
      form.append("body", body.trim());
      if (jobId) form.append("job_id", jobId);
      compressed.forEach((file, idx) => {
        form.append("attachments", sanitizeFileForUpload(file, `attachment_${idx + 1}`));
      });

      const res = await fetch("/api/portal/tickets", {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not create the ticket.");
        setSubmitting(false);
        return;
      }

      const ticketId = json.ticketId as string | undefined;
      onClose();
      if (ticketId) router.push(`/portal/tickets/${ticketId}`);
      else router.refresh();
    } catch (err) {
      console.error("[portal/tickets/new-drawer] submit error:", err);
      setError("Could not create the ticket. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !submitting && onClose()}
          />

          {/* Side panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="New ticket"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="absolute right-0 top-0 bottom-0 w-full sm:w-[min(560px,90vw)] bg-card shadow-2xl border-l border-border flex flex-col"
          >
            <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border-light">
              <div>
                <h2 className="text-lg font-bold text-text-primary">New support ticket</h2>
                <p className="text-xs text-text-tertiary mt-0.5">
                  Describe your issue — the Master team responds inside the thread.
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
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder="Brief summary of your issue"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  disabled={submitting}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                    Type
                  </label>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    disabled={submitting}
                  >
                    {TICKET_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                    Priority
                  </label>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    disabled={submitting}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {jobs.length > 0 && (
                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                    Related job <span className="text-text-tertiary font-normal normal-case">(optional)</span>
                  </label>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    disabled={submitting}
                  >
                    <option value="">None</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.reference} — {j.title}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                  rows={6}
                  placeholder="Describe the issue in detail..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={5000}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                  Attachments <span className="text-text-tertiary font-normal normal-case">(optional, up to {MAX_ATTACHMENTS})</span>
                </label>

                {attachments.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-2.5">
                        <Paperclip className="w-4 h-4 text-text-tertiary shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                          <p className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {attachments.length < MAX_ATTACHMENTS && (
                  <label className="flex items-center justify-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed border-border bg-surface-secondary hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors">
                    <ImagePlus className="w-5 h-5 text-text-tertiary" />
                    <span className="text-sm font-semibold text-text-secondary">
                      {attachments.length === 0 ? "Add files" : "Add more"}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleAddFiles}
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
                {submitting ? "Creating..." : "Create ticket"}
              </button>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
