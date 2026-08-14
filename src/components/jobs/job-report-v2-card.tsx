"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, ImageIcon, Loader2, ShieldCheck, Sparkles, Upload, ExternalLink, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  normalizeReport,
  renderableFields,
  type NormalizedReport,
  type ReportKind,
} from "@/lib/job-report-v2";
import {
  certificateAiEnvelope,
  certificateAttachmentUrls,
  certificateValidity,
  expiryHeadline,
  expirySourceNote,
  type CertificateValidity,
} from "@/lib/certificate-expiry";
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

  // Certificate jobs answer one question before any other: until when is this
  // valid? It comes from the typed field or from what the model read off the
  // attached document, and the strip below says which.
  const validity = useMemo(() => certificateValidity(rawReport), [rawReport]);
  const certificate = useMemo(() => {
    if (kind !== "final" || report?.template !== "certificate") return null;
    return {
      hasAttachment: certificateAttachmentUrls(rawReport).length > 0,
      ai: certificateAiEnvelope(rawReport),
    };
  }, [kind, report?.template, rawReport]);

  const [openingImageKey, setOpeningImageKey] = useState<string | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [readingCertificate, setReadingCertificate] = useState(false);

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

  const readCertificate = useCallback(async () => {
    setReadingCertificate(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/read-certificate`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Could not read the certificate.");
        return;
      }
      toast.success(
        body?.applied
          ? "Expiry date read from the certificate."
          : "Certificate read, but the expiry date was not usable.",
      );
      onApprovalChange?.();
    } finally {
      setReadingCertificate(false);
    }
  }, [jobId, onApprovalChange]);

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

      {validity ? <ValidityStrip validity={validity} /> : null}

      {certificate && !validity ? (
        <CertificateReadPrompt
          hasAttachment={certificate.hasAttachment}
          error={certificate.ai?.error ?? null}
          reading={readingCertificate}
          readOnly={readOnly}
          onRead={readCertificate}
        />
      ) : null}

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
              Revoke validation
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
              {/* "Validate" e não "Approve": aprovar, nesta operação, é o que
                  acontece na revisão final. Aqui é atestar que o conteúdo do
                  relatório está bom — o passo 4 da revisão. */}
              Validate report
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Three tones, so "expired" is never mistaken for the brand orange. */
const VALIDITY_TONE = {
  valid:    { fg: "#0F6E56", bg: "#F0FBF7", border: "#B5E3D1", Icon: ShieldCheck },
  expiring: { fg: "#B45309", bg: "#FFFBEB", border: "#F5DFA8", Icon: CalendarClock },
  expired:  { fg: "#A32D2D", bg: "#FDF3F3", border: "#EFC9C9", Icon: AlertTriangle },
} as const;

/** The one line that matters on a certificate job: until when is this good? */
function ValidityStrip({ validity }: { validity: CertificateValidity }) {
  const tone = VALIDITY_TONE[validity.state];
  return (
    <div
      className="rounded-[8px] px-3 py-[10px] flex items-start gap-2"
      style={{ background: tone.bg, border: `0.5px solid ${tone.border}` }}
    >
      <tone.Icon className="h-4 w-4 shrink-0 mt-[1px]" style={{ color: tone.fg }} />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold" style={{ color: tone.fg }}>
          {expiryHeadline(validity)}
        </p>
        {/* Inline, not flex: a long note wraps around the icon instead of
            stranding it alone on the line above. */}
        <p className="text-[11px]" style={{ color: "#6B6B70" }}>
          {validity.source === "ai" ? (
            <Sparkles
              className="h-3 w-3 inline-block align-[-1.5px] mr-1"
              style={{ color: "#9A9AA0" }}
            />
          ) : null}
          {expirySourceNote(validity)}
        </p>
      </div>
    </div>
  );
}

/**
 * Shown on a certificate report that has no expiry on it yet.
 *
 * New reports get read automatically when they are saved, so this is here for
 * the ones filed before that existed and for a document the model choked on.
 */
function CertificateReadPrompt({
  hasAttachment,
  error,
  reading,
  readOnly,
  onRead,
}: {
  hasAttachment: boolean;
  error:         string | null;
  reading:       boolean;
  readOnly?:     boolean;
  onRead:        () => void;
}) {
  const message = !hasAttachment
    ? "No certificate attached, so there is no expiry date to read."
    : error
      ? `Could not read the expiry date: ${error}`
      : "No expiry date on this certificate yet.";

  return (
    <div
      className="rounded-[8px] px-3 py-[10px] flex flex-wrap items-center justify-between gap-2"
      style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
    >
      <p className="text-[11px] min-w-0" style={{ color: "#6B6B70" }}>
        {message}
      </p>
      {hasAttachment && !readOnly ? (
        <button
          type="button"
          onClick={onRead}
          disabled={reading}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-[6px] px-[10px] py-[5px] text-[11px] font-medium cursor-pointer disabled:opacity-40 bg-white hover:bg-[#F1F1F3]"
          style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
        >
          {reading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {reading ? "Reading" : error ? "Try again" : "Read expiry date"}
        </button>
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
