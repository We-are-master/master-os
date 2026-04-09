"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
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

interface NewTicketClientProps {
  jobs: Array<{ id: string; reference: string; title: string }>;
}

export function NewTicketClient({ jobs }: NewTicketClientProps) {
  const router = useRouter();
  const [subject,    setSubject]    = useState("");
  const [type,       setType]       = useState("general");
  const [priority,   setPriority]   = useState("medium");
  const [body,       setBody]       = useState("");
  const [jobId,      setJobId]      = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const MAX_ATTACHMENTS = 5;

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
      // Compress images client-side before upload
      const compressed = await Promise.all(
        attachments.map((f) => compressImage(f)),
      );

      const form = new FormData();
      form.append("subject",  subject.trim());
      form.append("type",     type);
      form.append("priority", priority);
      form.append("body",     body.trim());
      if (jobId) form.append("job_id", jobId);
      compressed.forEach((file, idx) => {
        form.append("attachments", sanitizeFileForUpload(file, `attachment_${idx + 1}`));
      });

      const res = await fetch("/api/portal/tickets", {
        method: "POST",
        body:   form,
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not create the ticket.");
        setSubmitting(false);
        return;
      }
      const ticketId = json.ticketId as string | undefined;
      if (ticketId) {
        router.push(`/portal/tickets/${ticketId}`);
      } else {
        router.push("/portal/tickets");
      }
      router.refresh();
    } catch (err) {
      console.error("[portal/tickets/new] submit error:", err);
      setError("Could not create the ticket. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/portal/tickets"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to tickets
      </Link>

      <div className="bg-card rounded-2xl border border-border p-6 lg:p-8">
        <h1 className="text-2xl font-black text-text-primary mb-1">New support ticket</h1>
        <p className="text-sm text-text-secondary mb-6">
          Describe your issue and our team will get back to you.
        </p>

        {error && (
          <div className="mb-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
              placeholder="Brief summary of your issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                Type
              </label>
              <select
                className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
              <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                Priority
              </label>
              <select
                className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
              <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                Related job <span className="text-text-tertiary font-normal normal-case">(optional)</span>
              </label>
              <select
                className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
              rows={6}
              placeholder="Describe the issue in detail..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              disabled={submitting}
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Attachments <span className="text-text-tertiary font-normal normal-case">(optional, up to {MAX_ATTACHMENTS})</span>
            </label>

            {attachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachments.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-2.5">
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
              <label className="flex items-center justify-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed border-border bg-surface-secondary hover:border-orange-300 hover:bg-orange-50/10 cursor-pointer transition-colors">
                <ImagePlus className="w-5 h-5 text-text-tertiary" />
                <span className="text-sm font-semibold text-text-secondary">
                  {attachments.length === 0 ? "Add files" : "Add more"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleAddFiles}
                  disabled={submitting}
                />
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4">
            <Link
              href="/portal/tickets"
              className="px-5 py-2.5 rounded-xl border-2 border-border text-text-primary font-semibold text-sm hover:bg-surface-hover transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60 bg-orange-600"
            >
              {submitting ? "Creating..." : "Create ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
