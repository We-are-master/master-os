"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, FileText, ImageIcon, Loader2, ShieldCheck, Upload, ExternalLink, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  normalizeReport,
  renderableFields,
  type NormalizedReport,
  type ReportKind,
} from "@/lib/job-report-v2";
import { createSignedJobReportAssetUrl } from "@/services/job-reports";

interface JobReportV2CardProps {
  jobId:       string;
  kind:        ReportKind;
  rawReport:   unknown;
  /** ISO from jobs.<kind>_report_approved_at — null = pending review. */
  approvedAt:  string | null;
  /** profiles row joined as approved_by display name (optional). */
  approvedBy?: string | null;
  /** Read-only mode disables approve/reject buttons. */
  readOnly?:   boolean;
  /** Called after a successful approval toggle so the parent can refetch. */
  onApprovalChange?: () => void;
}

export function JobReportV2Card({
  jobId,
  kind,
  rawReport,
  approvedAt,
  approvedBy,
  readOnly,
  onApprovalChange,
}: JobReportV2CardProps) {
  const report = useMemo(() => normalizeReport(rawReport), [rawReport]);
  const fields = useMemo(() => (report ? renderableFields(report) : []), [report]);

  const [openingImageKey, setOpeningImageKey] = useState<string | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);

  const isApproved = !!approvedAt;
  const titleLabel = kind === "start" ? "Start report" : "Final report";

  const openImage = useCallback(async (rawUrl: string, key: string) => {
    setOpeningImageKey(key);
    try {
      const signed = await createSignedJobReportAssetUrl(rawUrl, 60 * 60);
      if (!signed) {
        toast.error("Could not sign image URL.");
        return;
      }
      window.open(signed, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningImageKey(null);
    }
  }, []);

  const setApproval = useCallback(async (approve: boolean) => {
    setSavingApproval(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/reports/${kind}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? `Could not ${approve ? "approve" : "unapprove"} report.`);
        return;
      }
      toast.success(approve ? "Report approved." : "Approval cleared.");
      onApprovalChange?.();
    } finally {
      setSavingApproval(false);
    }
  }, [jobId, kind, onApprovalChange]);

  if (!report) {
    return (
      <div
        className="rounded-[10px] p-4"
        style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" style={{ color: "#9A9AA0" }} />
          <p className="text-[13px] font-medium" style={{ color: "#020040" }}>
            {titleLabel}
          </p>
          <span
            className="ml-auto text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0"
            style={{ background: "#F1F1F3", color: "#6B6B70" }}
          >
            Not submitted
          </span>
        </div>
      </div>
    );
  }

  const cardStyle = isApproved
    ? { background: "#F0FBF7", border: "0.5px solid #B5E3D1" }
    : { background: "#FFF8F3", border: "0.5px solid #F5CFB8" };

  return (
    <div className="rounded-[10px] p-[14px] space-y-3" style={cardStyle}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isApproved ? (
            <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "#0F6E56" }} />
          ) : (
            <Upload className="h-4 w-4 shrink-0" style={{ color: "#ED4B00" }} />
          )}
          <p className="text-[13px] font-medium truncate" style={{ color: "#020040" }}>
            {titleLabel}
          </p>
          <span
            className="text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0 uppercase tracking-wide"
            style={{ background: "#1C1917", color: "#FFFFFF" }}
          >
            {report.template}
          </span>
        </div>
        <span
          className="text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0"
          style={
            isApproved
              ? { background: "#E4F5EE", color: "#0F6E56" }
              : { background: "#FFF1EB", color: "#ED4B00" }
          }
        >
          {isApproved ? "Approved" : "Pending review"}
        </span>
      </div>

      <div className="text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#6B6B70" }}>
        {report.submittedAt ? (
          <span>
            Submitted{" "}
            {report.submittedAt.toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "Europe/London",
            })}
          </span>
        ) : null}
        {approvedAt ? (
          <span style={{ color: "#0F6E56" }}>
            Approved{" "}
            {new Date(approvedAt).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "Europe/London",
            })}
            {approvedBy ? ` by ${approvedBy}` : ""}
          </span>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <div className="rounded-[8px] p-3 bg-white space-y-1.5" style={{ border: "0.5px solid #E4E4E8" }}>
          {fields.map((f) => (
            <div key={f.key} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className="font-semibold shrink-0" style={{ color: "#020040" }}>
                {f.label}:
              </span>
              <span className="break-words" style={{ color: "#3A3A55", whiteSpace: "pre-wrap" }}>
                {f.display}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {report.photosByRoom ? (
        <div className="space-y-2">
          {Object.entries(report.photosByRoom).map(([room, urls]) =>
            urls.length === 0 ? null : (
              <div key={room} className="rounded-[8px] p-3 bg-white" style={{ border: "0.5px solid #E4E4E8" }}>
                <p
                  className="text-[10px] font-bold uppercase tracking-wide mb-2"
                  style={{ color: "#6B6B70" }}
                >
                  {room.replace(/_/g, " ")}{" "}
                  <span style={{ color: "#A8A29E" }}>· {urls.length} photo{urls.length === 1 ? "" : "s"}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {urls.map((u, i) => (
                    <ImageButton
                      key={`${room}-${i}`}
                      url={u}
                      label={`${room}-${i}`}
                      onOpen={openImage}
                      opening={openingImageKey === `${room}-${i}`}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      ) : report.photosFlat.length > 0 ? (
        <div className="rounded-[8px] p-3 bg-white" style={{ border: "0.5px solid #E4E4E8" }}>
          <p
            className="text-[10px] font-bold uppercase tracking-wide mb-2"
            style={{ color: "#6B6B70" }}
          >
            Photos <span style={{ color: "#A8A29E" }}>· {report.photosFlat.length}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {report.photosFlat.map((p, i) => (
              <ImageButton
                key={`flat-${i}`}
                url={p.url}
                label={`flat-${i}`}
                onOpen={openImage}
                opening={openingImageKey === `flat-${i}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="flex items-center gap-2 pt-1">
          {isApproved ? (
            <button
              type="button"
              onClick={() => void setApproval(false)}
              disabled={savingApproval}
              className="inline-flex items-center gap-1.5 bg-white rounded-[6px] px-[10px] py-[6px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            >
              {savingApproval ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              Revoke approval
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void setApproval(true)}
              disabled={savingApproval}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[6px] text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#0F6E56", color: "#FFFFFF" }}
            >
              {savingApproval ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve report
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ImageButton({
  url,
  label,
  onOpen,
  opening,
}: {
  url:     string;
  label:   string;
  onOpen:  (url: string, label: string) => void;
  opening: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(url, label)}
      disabled={opening}
      className="inline-flex items-center gap-1 rounded-[6px] px-[8px] py-[5px] text-[11px] font-medium cursor-pointer disabled:opacity-40"
      style={{ background: "#FAFAFB", color: "#020040", border: "0.5px solid #D8D8DD" }}
      aria-label="Open image"
    >
      {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
      {opening ? "Opening" : "Image"}
    </button>
  );
}

export interface JobReportV2DownloadButtonProps {
  jobId:    string;
  reference: string;
}

export function JobReportV2DownloadButton({ jobId, reference }: JobReportV2DownloadButtonProps) {
  return (
    <a
      href={`/api/jobs/${jobId}/reports/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 bg-white rounded-[6px] px-[12px] py-[6px] text-[12px] font-medium hover:bg-[#FAFAFB]"
      style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
    >
      <ExternalLink className="h-3 w-3" />
      Download PDF · {reference}
    </a>
  );
}

export default JobReportV2Card;
