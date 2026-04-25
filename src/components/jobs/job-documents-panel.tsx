"use client";

import { useState } from "react";
import { FileText, ExternalLink, Loader2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import type { Job, JobComplianceDocument, JobComplianceDocKind } from "@/types/database";
import { uploadJobComplianceDocument, removeJobComplianceDocumentFromStorage } from "@/services/job-compliance-doc-storage";

const KIND_META: { kind: JobComplianceDocKind; title: string; hint: string }[] = [
  { kind: "contract", title: "Contract", hint: "Works or client contract" },
  { kind: "rams", title: "RAMS", hint: "Risk assessment & method statement" },
  { kind: "other", title: "Other", hint: "Additional PDF or document" },
];

function parseComplianceDocs(raw: unknown): JobComplianceDocument[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is JobComplianceDocument =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as JobComplianceDocument).id === "string" &&
      typeof (x as JobComplianceDocument).storage_path === "string" &&
      typeof (x as JobComplianceDocument).public_url === "string" &&
      typeof (x as JobComplianceDocument).kind === "string",
  );
}

function docForKind(docs: JobComplianceDocument[], kind: JobComplianceDocKind): JobComplianceDocument | undefined {
  return docs.find((d) => d.kind === kind);
}

export function JobDocumentsPanel({
  job,
  onUpdate,
}: {
  job: Job;
  onUpdate: (jobId: string, patch: Partial<Job>, opts?: { silent?: boolean }) => Promise<Job | undefined>;
}) {
  const [uploadingKind, setUploadingKind] = useState<JobComplianceDocKind | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const docs = parseComplianceDocs(job.compliance_documents);

  const setDocForKind = async (kind: JobComplianceDocKind, file: File) => {
    setUploadingKind(kind);
    try {
      const prev = docForKind(docs, kind);
      if (prev?.storage_path) {
        try {
          await removeJobComplianceDocumentFromStorage(prev.storage_path);
        } catch {
          /* best-effort; still replace in DB */
        }
      }
      const up = await uploadJobComplianceDocument(job.id, file);
      const now = new Date().toISOString();
      const nextDoc: JobComplianceDocument = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `doc-${Date.now()}`,
        kind,
        label: null,
        storage_path: up.path,
        public_url: up.publicUrl,
        mime_type: up.mimeType,
        uploaded_at: now,
      };
      const withoutKind = docs.filter((d) => d.kind !== kind);
      const merged = [...withoutKind, nextDoc];
      await onUpdate(job.id, { compliance_documents: merged }, { silent: true });
      toast.success(`${KIND_META.find((k) => k.kind === kind)?.title ?? "Document"} saved`);
    } catch (e) {
      toast.error(getErrorMessage(e, "Upload failed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const removeDoc = async (d: JobComplianceDocument) => {
    setRemovingId(d.id);
    try {
      await removeJobComplianceDocumentFromStorage(d.storage_path);
      const merged = docs.filter((x) => x.id !== d.id);
      await onUpdate(job.id, { compliance_documents: merged }, { silent: true });
      toast.success("Document removed");
    } catch (e) {
      toast.error(getErrorMessage(e, "Remove failed"));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div
      className="rounded-[12px] overflow-hidden bg-white"
      style={{ border: "0.5px solid #E4E4E8", boxShadow: "0 1px 3px rgba(2,0,64,0.04)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-[18px] py-[14px]"
        style={{ background: "#FAFAFB", borderBottom: "0.5px solid #E4E4E8" }}
      >
        <p
          className="text-[11px] font-medium uppercase flex items-center gap-1.5"
          style={{ color: "#020040", letterSpacing: "0.6px" }}
        >
          <FolderOpen className="h-3.5 w-3.5" /> Documents
        </p>
        <p className="text-[10px] text-text-tertiary">PDF, DOC, DOCX · max 10 MB</p>
      </div>
      <div className="p-[18px]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px]">
          {KIND_META.map((meta) => {
            const d = docForKind(docs, meta.kind);
            const busy = uploadingKind === meta.kind;
            return (
              <div
                key={meta.kind}
                className="rounded-[10px] p-[14px] space-y-2"
                style={
                  d
                    ? { background: "#F0FBF7", border: "0.5px solid #B5E3D1" }
                    : { background: "#FAFAFB", border: "0.5px solid #E4E4E8" }
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">{meta.title}</p>
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                      d ? "bg-emerald-100 text-emerald-800" : "bg-surface-tertiary text-text-tertiary",
                    )}
                  >
                    {d ? "Uploaded" : "Not uploaded"}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary leading-snug">{meta.hint}</p>
                {d ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={d.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-text-tertiary hover:text-red-600 h-8"
                      disabled={removingId === d.id}
                      onClick={() => void removeDoc(d)}
                    >
                      {removingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remove"}
                    </Button>
                  </div>
                ) : null}
                <label
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-3 text-center transition-colors",
                    busy
                      ? "opacity-60 pointer-events-none border-border"
                      : "border-border cursor-pointer hover:border-primary/40 bg-white/50",
                  )}
                >
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void setDocForKind(meta.kind, f);
                    }}
                  />
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  ) : (
                    <span className="text-xs font-medium text-primary">Choose file</span>
                  )}
                  <span className="text-[10px] text-text-tertiary">Replace or add</span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
