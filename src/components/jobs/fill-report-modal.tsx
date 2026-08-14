"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { FixfyModalFooter } from "@/components/ui/fixfy-modal/fixfy-modal-footer";
import {
  fieldsForTemplate,
  isFieldVisible,
  photoSlotsForTemplate,
  pickReportTemplate,
  reportSectionTitles,
  reportTemplateDisplayLabel,
  type ReportField,
  type ReportPhotoSlot,
  type ReportTemplate,
} from "@/lib/public-report-templates";
import { isPdfFile, prepareUploadFile, splitReportFields } from "@/lib/report-photo-upload";

const NAVY = "#020040";
const ORANGE = "#ED4B00";
const BORDER = "#E4E4E8";
const MUTED = "#6B6B70";

interface FillReportModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobReference: string;
  jobTitle: string | null;
  /** Optional: jobs carry the trade in the title, quotes carry it separately. */
  serviceType?: string | null;
  /** `YYYY-MM-DD` of the visit — anchors the clock times below. */
  scheduledDate: string | null;
  /** True when the partner already sent the arrival half from the app. */
  startAlreadySubmitted: boolean;
  onSubmitted: () => void;
  /** Edit mode: raw start/final report payloads to prefill and overwrite. */
  existingStart?: Record<string, unknown> | null;
  existingFinal?: Record<string, unknown> | null;
  /** Existing on-site window (ISO) — prefills the clock times on edit. */
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
}

const ENVELOPE_KEYS = new Set(["template", "submitted_at", "photos", "source", "duration_ms", "chargeable_hours"]);

/** ISO instant → London wall-clock `HH:MM` for a `<input type=time>`. */
function londonHHMM(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function countPhotos(payload: Record<string, unknown> | null | undefined): number {
  const p = payload?.photos;
  if (Array.isArray(p)) return p.filter((u) => typeof u === "string" && u).length;
  if (p && typeof p === "object") {
    return Object.values(p as Record<string, unknown>).reduce<number>(
      (acc, urls) => acc + (Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && u).length : 0),
      0,
    );
  }
  return 0;
}

/**
 * Types a partner's work report from inside the OS.
 *
 * Most partners never open the app: 198 completed jobs produced 16 reports.
 * The office already has the facts — a WhatsApp message, photos, a phone call —
 * and this is where they get typed into the same V2 shape the app writes, so
 * the PDF and Stefane work identically no matter who filled it in.
 */
export function FillReportModal({
  open,
  onClose,
  jobId,
  jobReference,
  jobTitle,
  serviceType = null,
  scheduledDate,
  startAlreadySubmitted,
  onSubmitted,
  existingStart = null,
  existingFinal = null,
  timerStartedAt = null,
  timerEndedAt = null,
}: FillReportModalProps) {
  const isEdit = !!existingFinal;
  const template: ReportTemplate = useMemo(
    () => pickReportTemplate({ serviceType, title: jobTitle }),
    [serviceType, jobTitle],
  );
  const spec = useMemo(() => fieldsForTemplate(template), [template]);
  const photoSlots = useMemo(() => photoSlotsForTemplate(template), [template]);
  const sections = useMemo(() => reportSectionTitles(template), [template]);

  const [data, setData] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [visitYmd, setVisitYmd] = useState(scheduledDate ?? "");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existingPhotoCount = countPhotos(existingStart) + countPhotos(existingFinal);

  // Edit mode: seed the fields and the clock times from what is on the job.
  // Runs on every open so a stale draft never shadows the saved report.
  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, unknown> = {};
    for (const payload of [existingStart, existingFinal]) {
      if (!payload) continue;
      for (const [k, v] of Object.entries(payload)) {
        if (ENVELOPE_KEYS.has(k) || v === null || v === undefined) continue;
        seeded[k] = v;
      }
    }
    setData(seeded);
    setPhotos({});
    setVisitYmd(scheduledDate ?? "");
    setStartTime(londonHHMM(timerStartedAt));
    setFinishTime(londonHHMM(timerEndedAt));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the modal opens
  }, [open]);

  const setField = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const onPhotosChange = (slot: string, files: FileList | null) => {
    if (!files) return;
    setPhotos((prev) => ({ ...prev, [slot]: [...(prev[slot] ?? []), ...Array.from(files)] }));
  };

  const removePhoto = (slot: string, idx: number) =>
    setPhotos((prev) => ({ ...prev, [slot]: (prev[slot] ?? []).filter((_, i) => i !== idx) }));

  /** Minutes on site from the two clock times — what Housekeep asks for. */
  const durationMinutes = useMemo(() => {
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(finishTime)) return null;
    const [sh, sm] = startTime.split(":").map(Number);
    const [fh, fm] = finishTime.split(":").map(Number);
    const mins = fh * 60 + fm - (sh * 60 + sm);
    return mins > 0 ? mins : null;
  }, [startTime, finishTime]);

  const timesInvalid =
    startTime !== "" && finishTime !== "" && durationMinutes === null;

  const inputClass =
    "w-full rounded-[6px] border px-3 py-2 text-[13px] text-[#020040] placeholder:text-[#9A9AAE] focus:outline-none focus:ring-2 focus:ring-[#ED4B00]/20 focus:border-[#ED4B00]";

  const renderField = (f: ReportField) => {
    if (!isFieldVisible(f, data)) return null;
    const val = data[f.key];
    const label = (
      <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
        {f.label}
      </label>
    );
    const hint = f.hint ? (
      <p className="text-[11px] leading-snug" style={{ color: MUTED }}>{f.hint}</p>
    ) : null;

    switch (f.type) {
      case "boolean":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <div className="flex gap-2">
              {[true, false].map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  onClick={() => setField(f.key, b)}
                  className="min-w-[4rem] rounded-[6px] border px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
                  style={
                    val === b
                      ? { background: NAVY, color: "#fff", borderColor: NAVY }
                      : { background: "#fff", color: NAVY, borderColor: BORDER }
                  }
                >
                  {b ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        );
      case "number":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <input
              type="number"
              min={0}
              value={typeof val === "number" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
      case "select":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <select
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={`${inputClass} bg-white`}
              style={{ borderColor: BORDER }}
            >
              <option value="">Select…</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        );
      case "longtext":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            {hint}
            <textarea
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              rows={3}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
      default:
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            {hint}
            <input
              type="text"
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
    }
  };

  const renderThumb = (slot: string, f: File, i: number) => {
    if (isPdfFile(f)) {
      return (
        <div
          key={`${slot}-${i}`}
          className="relative flex h-16 flex-col items-center justify-center rounded-[6px] border bg-[#FAFAFB] p-1.5"
          style={{ borderColor: BORDER }}
        >
          <FileText className="h-4 w-4" style={{ color: NAVY }} />
          <p className="mt-0.5 max-w-full truncate text-[9px]" style={{ color: MUTED }}>{f.name}</p>
          <button
            type="button"
            onClick={() => removePhoto(slot, i)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white cursor-pointer"
            aria-label="Remove file"
          >
            ×
          </button>
        </div>
      );
    }
    return (
      <div key={`${slot}-${i}`} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={URL.createObjectURL(f)}
          alt=""
          className="h-16 w-full rounded-[6px] border object-cover"
          style={{ borderColor: BORDER }}
        />
        <button
          type="button"
          onClick={() => removePhoto(slot, i)}
          className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white cursor-pointer"
          aria-label="Remove photo"
        >
          ×
        </button>
      </div>
    );
  };

  const renderPhotoSlot = (slot: ReportPhotoSlot) => {
    const files = photos[slot.key] ?? [];
    return (
      <div key={slot.key} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[12px] font-semibold" style={{ color: NAVY }}>{slot.label}</label>
          <label
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold"
            style={{ color: ORANGE }}
          >
            <Upload className="h-3 w-3" />
            Add files
            <input
              type="file"
              accept={slot.accept ?? "image/*"}
              multiple
              className="sr-only"
              onChange={(e) => onPhotosChange(slot.key, e.target.files)}
            />
          </label>
        </div>
        {files.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {files.map((f, i) => renderThumb(slot.key, f, i))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: MUTED }}>None added</p>
        )}
      </div>
    );
  };

  const section = (title: string, children: ReactNode) => (
    <section
      className="space-y-3 rounded-[10px] p-3 sm:p-[14px]"
      style={{ background: "#FAFAFB", border: `0.5px solid ${BORDER}` }}
    >
      <h3 className="text-[10px] font-bold uppercase" style={{ color: ORANGE, letterSpacing: "0.6px" }}>
        {title}
      </h3>
      {children}
    </section>
  );

  const submit = async () => {
    setError(null);
    if (timesInvalid) {
      setError("Finish time must be after the start time.");
      return;
    }

    const { startFields, finalFields } = splitReportFields(spec, data);
    if (durationMinutes !== null) {
      finalFields.duration_ms = durationMinutes * 60_000;
      if (template === "gardener") finalFields.chargeable_hours = durationMinutes / 60;
    }

    const form = new FormData();
    form.set("template", template);
    form.set("startData", JSON.stringify(startFields));
    form.set("finalData", JSON.stringify(finalFields));
    if (isEdit) form.set("overwrite", "1");
    if (visitYmd) form.set("visitYmd", visitYmd);
    if (startTime) form.set("startTime", startTime);
    if (finishTime) form.set("finishTime", finishTime);

    setSubmitting(true);
    setProgress("Processing files…");
    try {
      for (const [slot, slotFiles] of Object.entries(photos)) {
        for (let i = 0; i < slotFiles.length; i++) {
          form.append(`photos[${slot}][]`, await prepareUploadFile(slotFiles[i], slot, i));
        }
      }
      setProgress("Saving report…");
      const res = await fetch(`/api/jobs/${jobId}/office-report`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; photoFailures?: number }
        | null;
      if (!res.ok) {
        setError(body?.error ?? "Could not save the report.");
        return;
      }
      if (body?.photoFailures) {
        toast.warning(`Report saved, but ${body.photoFailures} file(s) failed to upload.`);
      } else {
        toast.success(isEdit ? "Report updated." : "Report saved on the job.");
      }
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error saving the report.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? "Edit partner report" : "Fill report for the partner"}
      subtitle={`${jobReference} · ${reportTemplateDisplayLabel(template)} template`}
      size="lg"
      footer={
        <FixfyModalFooter
          leading={
            // Escondido no celular: a 375px é esta frase que espremia os dois
            // botões contra a borda.
            <span className="hidden sm:block">
              {isEdit
                ? existingPhotoCount > 0
                  ? `Fields are replaced · the ${existingPhotoCount} photo(s) already saved stay, new files are added.`
                  : "Fields are replaced · new files are added to the report."
                : "Saved as an office-typed report and marked validated."}
            </span>
          }
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="shrink-0 rounded-[6px] bg-white px-[14px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40"
            style={{ color: NAVY, border: `0.5px solid #D8D8DD` }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-[14px] py-[7px] text-[12px] font-semibold text-white cursor-pointer disabled:opacity-40"
            style={{ background: NAVY }}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {submitting ? progress || "Saving…" : isEdit ? "Save changes" : "Save report"}
          </button>
        </FixfyModalFooter>
      }
    >
      {/* O `Modal` não injeta padding no corpo: cada modal traz o seu, e a
          falta dele era o conteúdo colado na borda. */}
      <div className="space-y-3 p-4 sm:p-5">
        {startAlreadySubmitted ? (
          <div
            className="rounded-[8px] px-3 py-2 text-[11px]"
            style={{ background: "#F4F5FB", border: "0.5px solid #D8DBEE", color: NAVY }}
          >
            The partner already sent the arrival half from the app. Only the completion
            report below will be written.
          </div>
        ) : null}

        {section(
          "On site",
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Visit date
                </label>
                <input
                  type="date"
                  value={visitYmd}
                  onChange={(e) => setVisitYmd(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Start time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Finish time
                </label>
                <input
                  type="time"
                  value={finishTime}
                  onChange={(e) => setFinishTime(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
            </div>
            <p className="text-[11px]" style={{ color: timesInvalid ? ORANGE : MUTED }}>
              {timesInvalid
                ? "Finish time must be after the start time."
                : durationMinutes !== null
                  ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m on site · London time, sent to the client platform.`
                  : "London time. These become the start and finish times on the client platform."}
            </p>
          </>,
        )}

        {!startAlreadySubmitted && (spec.start.length > 0 || photoSlots.start.length > 0)
          ? section(
              sections.start,
              <>
                <div className="space-y-3">{spec.start.map(renderField)}</div>
                {photoSlots.start.length > 0 ? (
                  <div className="space-y-2 border-t pt-3" style={{ borderColor: BORDER }}>
                    {photoSlots.start.map(renderPhotoSlot)}
                  </div>
                ) : null}
              </>,
            )
          : null}

        {section(
          sections.final,
          <>
            <div className="space-y-3">{spec.final.map(renderField)}</div>
            {photoSlots.final.length > 0 ? (
              <div className="space-y-2 border-t pt-3" style={{ borderColor: BORDER }}>
                {photoSlots.final.map(renderPhotoSlot)}
              </div>
            ) : null}
          </>,
        )}

        {error ? (
          <div
            className="rounded-[8px] p-2.5 text-[12px]"
            style={{ background: "#FFF1EB", border: "0.5px solid #F5CFB8", color: "#7A3D00" }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default FillReportModal;
