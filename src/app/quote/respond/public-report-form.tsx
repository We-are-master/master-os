"use client";

import { FileText, Upload } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  fieldsForTemplate,
  photoSlotsForTemplate,
  reportSectionTitles,
  reportTemplateDisplayLabel,
  type ReportField,
  type ReportPhotoSlot,
  type ReportTemplate,
} from "@/lib/public-report-templates";
import {
  FIXFY_BORDER,
  FIXFY_MUTED,
  FIXFY_NAVY,
  FIXFY_ORANGE,
  FixfyPublicHeader,
} from "./public-fixfy-shell";

interface PublicReportFormProps {
  token:           string;
  jobReference:    string;
  jobTitle:        string;
  propertyAddress: string;
  serviceType:     string | null;
  template:        ReportTemplate;
  onSubmitted:     () => void;
}

const MAX_PHOTO_LONG_EDGE = 1600;
const PHOTO_JPEG_QUALITY  = 0.75;

async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_PHOTO_LONG_EDGE ? MAX_PHOTO_LONG_EDGE / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encode failed."))),
      "image/jpeg",
      PHOTO_JPEG_QUALITY,
    );
  });
  bitmap.close();
  return blob;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function prepareUploadFile(file: File, slotKey: string, index: number): Promise<File> {
  if (isPdfFile(file)) return file;
  const blob = await downscaleImage(file);
  return new File([blob], `${slotKey}-${index}.jpg`, { type: "image/jpeg" });
}

function fieldInputClass(): string {
  return "w-full rounded-lg border px-3 py-2.5 text-[14px] text-[#0A0A1F] placeholder:text-[#9A9AAE] focus:outline-none focus:ring-2 focus:ring-[#ED4B00]/25 focus:border-[#ED4B00]";
}

export default function PublicReportForm({
  token,
  jobReference,
  jobTitle,
  propertyAddress,
  serviceType,
  template,
  onSubmitted,
}: PublicReportFormProps) {
  const spec = useMemo(() => fieldsForTemplate(template), [template]);
  const photoSlots = useMemo(() => photoSlotsForTemplate(template), [template]);
  const sections = useMemo(() => reportSectionTitles(template), [template]);
  const templateLabel = reportTemplateDisplayLabel(template);
  const isCertificate = template === "certificate";

  const [data, setData] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setField = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const onPhotosChange = (slot: string, files: FileList | null) => {
    if (!files) return;
    setPhotos((prev) => ({ ...prev, [slot]: [...(prev[slot] ?? []), ...Array.from(files)] }));
  };

  const removePhoto = (slot: string, idx: number) => {
    setPhotos((prev) => ({
      ...prev,
      [slot]: (prev[slot] ?? []).filter((_, i) => i !== idx),
    }));
  };

  const renderBoolean = (f: ReportField, val: unknown) => (
    <div className="flex flex-wrap gap-2">
      {[true, false].map((b) => (
        <button
          key={String(b)}
          type="button"
          onClick={() => setField(f.key, b)}
          className="min-w-[4.5rem] rounded-lg border px-4 py-2 text-[13px] font-semibold transition-colors"
          style={
            val === b
              ? { background: FIXFY_NAVY, color: "#fff", borderColor: FIXFY_NAVY }
              : { background: "#fff", color: FIXFY_NAVY, borderColor: FIXFY_BORDER }
          }
        >
          {b ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );

  const renderField = (f: ReportField) => {
    if (f.showIf) {
      const gateValue = data[f.showIf.key];
      if (gateValue !== f.showIf.equals) return null;
    }
    const val = data[f.key];
    const label = (
      <label className="block text-[13px] font-semibold" style={{ color: FIXFY_NAVY }}>
        {f.label}
      </label>
    );
    const hint = f.hint ? (
      <p className="text-[11px] leading-snug" style={{ color: FIXFY_MUTED }}>{f.hint}</p>
    ) : null;

    switch (f.type) {
      case "boolean":
        return (
          <div key={f.key} className="space-y-2">
            {label}
            {renderBoolean(f, val)}
          </div>
        );
      case "number":
        return (
          <div key={f.key} className="space-y-2">
            {label}
            <input
              type="number"
              min={0}
              value={typeof val === "number" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
              className={fieldInputClass()}
              style={{ borderColor: FIXFY_BORDER }}
            />
          </div>
        );
      case "select":
        return (
          <div key={f.key} className="space-y-2">
            {label}
            <select
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={`${fieldInputClass()} bg-white`}
              style={{ borderColor: FIXFY_BORDER }}
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
          <div key={f.key} className="space-y-2">
            {label}
            {hint}
            <textarea
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              rows={3}
              className={fieldInputClass()}
              style={{ borderColor: FIXFY_BORDER }}
            />
          </div>
        );
      case "text":
      default:
        return (
          <div key={f.key} className="space-y-2">
            {label}
            {hint}
            <input
              type="text"
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={fieldInputClass()}
              style={{ borderColor: FIXFY_BORDER }}
            />
          </div>
        );
    }
  };

  const renderPhotoThumb = (slot: string, f: File, i: number) => {
    if (isPdfFile(f)) {
      return (
        <div
          key={`${slot}-${i}`}
          className="relative flex h-20 flex-col items-center justify-center rounded-lg border bg-[#F7F7FB] p-2"
          style={{ borderColor: FIXFY_BORDER }}
        >
          <FileText className="h-6 w-6" style={{ color: FIXFY_NAVY }} />
          <p className="mt-1 max-w-full truncate text-[10px] font-medium" style={{ color: FIXFY_MUTED }}>
            {f.name}
          </p>
          <button
            type="button"
            onClick={() => removePhoto(slot, i)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] text-white"
            aria-label="Remove file"
          >
            ×
          </button>
        </div>
      );
    }
    const url = URL.createObjectURL(f);
    return (
      <div key={`${slot}-${i}`} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="h-20 w-full rounded-lg border object-cover"
          style={{ borderColor: FIXFY_BORDER }}
        />
        <button
          type="button"
          onClick={() => removePhoto(slot, i)}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] text-white"
          aria-label="Remove photo"
        >
          ×
        </button>
      </div>
    );
  };

  const renderPhotoSlot = (slot: ReportPhotoSlot) => {
    const files = photos[slot.key] ?? [];
    const accept = slot.accept ?? "image/*";

    if (slot.prominent) {
      return (
        <div key={slot.key} className="space-y-3">
          <div>
            <p className="text-[13px] font-semibold" style={{ color: FIXFY_NAVY }}>{slot.label}</p>
            {slot.hint ? (
              <p className="mt-1 text-[12px] leading-snug" style={{ color: FIXFY_MUTED }}>{slot.hint}</p>
            ) : null}
            {slot.optional ? (
              <p className="mt-0.5 text-[11px]" style={{ color: FIXFY_MUTED }}>Optional</p>
            ) : null}
          </div>
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors hover:border-[#ED4B00]/50 hover:bg-[#FFF7F3]"
            style={{ borderColor: "#F5CFB8", background: "#FFFBF8" }}
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "linear-gradient(135deg,#ED4B00 0%,#FF7A29 100%)" }}
            >
              <Upload className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: FIXFY_NAVY }}>
                Tap to upload certificate
              </p>
              <p className="mt-1 text-[12px]" style={{ color: FIXFY_MUTED }}>
                PDF or photo · you can add more than one file
              </p>
            </div>
            <input
              type="file"
              accept={accept}
              multiple
              className="sr-only"
              onChange={(e) => onPhotosChange(slot.key, e.target.files)}
            />
          </label>
          {files.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {files.map((f, i) => renderPhotoThumb(slot.key, f, i))}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div key={slot.key} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[13px] font-semibold" style={{ color: FIXFY_NAVY }}>{slot.label}</label>
          <label className="cursor-pointer text-[12px] font-semibold underline" style={{ color: FIXFY_ORANGE }}>
            Add photos
            <input
              type="file"
              accept={accept}
              multiple
              capture="environment"
              className="sr-only"
              onChange={(e) => onPhotosChange(slot.key, e.target.files)}
            />
          </label>
        </div>
        {slot.optional ? (
          <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Optional</p>
        ) : null}
        {files.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {files.map((f, i) => renderPhotoThumb(slot.key, f, i))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>No photos added</p>
        )}
      </div>
    );
  };

  const submit = async () => {
    setError(null);

    const startFields: Record<string, unknown> = {};
    for (const f of spec.start) {
      if (f.showIf && data[f.showIf.key] !== f.showIf.equals) continue;
      const v = data[f.key];
      if (v === undefined || v === null || v === "") continue;
      startFields[f.key] = v;
    }
    const finalFields: Record<string, unknown> = {};
    for (const f of spec.final) {
      if (f.showIf && data[f.showIf.key] !== f.showIf.equals) continue;
      const v = data[f.key];
      if (v === undefined || v === null || v === "") continue;
      finalFields[f.key] = v;
    }

    const h = Number(hours) || 0;
    const m = Number(minutes) || 0;
    const durationMs = (h * 3600 + m * 60) * 1000;
    if (durationMs > 0) {
      finalFields.duration_ms = durationMs;
      if (template === "gardener") {
        finalFields.chargeable_hours = h + m / 60;
      }
    }

    const form = new FormData();
    form.set("token", token);
    form.set("template", template);
    form.set("startData", JSON.stringify(startFields));
    form.set("finalData", JSON.stringify(finalFields));

    setSubmitting(true);
    setProgress("Processing files…");
    try {
      for (const [slot, slotFiles] of Object.entries(photos)) {
        for (let i = 0; i < slotFiles.length; i++) {
          const prepared = await prepareUploadFile(slotFiles[i], slot, i);
          form.append(`photos[${slot}][]`, prepared);
        }
      }
      setProgress("Uploading report…");
      const res = await fetch("/api/quotes/submit-report", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Could not submit the report.");
        return;
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error submitting the report.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  const sectionCard = (title: string, children: ReactNode) => (
    <section
      className="space-y-4 rounded-xl border bg-white p-4 sm:p-5"
      style={{ borderColor: FIXFY_BORDER }}
    >
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: FIXFY_ORANGE }}>
        {title}
      </h3>
      {children}
    </section>
  );

  const certificateUploadFirst = isCertificate && photoSlots.final.length > 0;

  return (
    <div className="flex min-h-full flex-col bg-white">
      <FixfyPublicHeader eyebrow="Partner report" />

      <div className="flex-1 space-y-5 px-5 py-6 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-[22px] font-bold leading-tight" style={{ color: FIXFY_NAVY }}>
            {jobTitle || jobReference}
          </h1>
          <p className="text-[13px] leading-snug" style={{ color: FIXFY_MUTED }}>
            {propertyAddress}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{ background: "#F7F7FB", color: FIXFY_NAVY, border: `1px solid ${FIXFY_BORDER}` }}
            >
              {jobReference}
            </span>
            {serviceType ? (
              <span className="text-[12px]" style={{ color: FIXFY_MUTED }}>{serviceType}</span>
            ) : null}
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: "#E8F4FD", color: "#0B5FFF" }}
            >
              {templateLabel}
            </span>
          </div>
        </header>

        {spec.start.length > 0
          ? sectionCard(
              sections.start,
              <>
                <div className="space-y-4">{spec.start.map(renderField)}</div>
                {photoSlots.start.length > 0 ? (
                  <div className="space-y-3 border-t pt-4" style={{ borderColor: FIXFY_BORDER }}>
                    {photoSlots.start.map(renderPhotoSlot)}
                  </div>
                ) : null}
              </>,
            )
          : null}

        {sectionCard(
          sections.final,
          <>
            {certificateUploadFirst ? (
              <div className="space-y-4">{photoSlots.final.map(renderPhotoSlot)}</div>
            ) : null}
            <div className="space-y-4">{spec.final.map(renderField)}</div>
            <div
              className="space-y-2 rounded-lg border px-3 py-3"
              style={{ borderColor: FIXFY_BORDER, background: "#F7F7FB" }}
            >
              <label className="block text-[13px] font-semibold" style={{ color: FIXFY_NAVY }}>
                Time spent on site
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="Hours"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className={`${fieldInputClass()} w-28 bg-white`}
                  style={{ borderColor: FIXFY_BORDER }}
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  placeholder="Mins"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className={`${fieldInputClass()} w-28 bg-white`}
                  style={{ borderColor: FIXFY_BORDER }}
                />
              </div>
            </div>
            {!certificateUploadFirst && photoSlots.final.length > 0 ? (
              <div className="space-y-3 border-t pt-4" style={{ borderColor: FIXFY_BORDER }}>
                {photoSlots.final.map(renderPhotoSlot)}
              </div>
            ) : null}
          </>,
        )}

        {error ? (
          <div
            className="rounded-lg border p-3 text-[13px]"
            style={{ background: "#FFF1EB", borderColor: "#F5CFB8", color: "#7A3D00" }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="w-full rounded-xl px-4 py-3.5 text-[15px] font-bold text-white shadow-sm transition-opacity disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#ED4B00 0%,#FF7A29 100%)" }}
        >
          {submitting ? (progress || "Submitting…") : "Submit report"}
        </button>

        <p className="pb-2 text-center text-[11px] leading-relaxed" style={{ color: FIXFY_MUTED }}>
          Questions? Email{" "}
          <a href="mailto:support@getfixfy.com" className="font-semibold underline" style={{ color: FIXFY_ORANGE }}>
            support@getfixfy.com
          </a>
        </p>
      </div>
    </div>
  );
}
