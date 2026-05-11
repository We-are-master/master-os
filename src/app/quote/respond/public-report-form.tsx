"use client";

import { useMemo, useState } from "react";
import {
  fieldsForTemplate,
  photoSlotsForTemplate,
  type ReportField,
  type ReportTemplate,
} from "@/lib/public-report-templates";

interface PublicReportFormProps {
  token:           string;
  jobReference:    string;
  jobTitle:        string;
  propertyAddress: string;
  serviceType:     string | null;
  /** Auto-detected template (callers may override later if needed). */
  template:        ReportTemplate;
  onSubmitted:     () => void;
}

const MAX_PHOTO_LONG_EDGE = 1600;
const PHOTO_JPEG_QUALITY  = 0.75;

/**
 * Client-side image downscale → JPEG. Mirrors what the mobile app should be
 * doing (it currently uploads raw camera output). Drops a 4000×3000 / 3 MB
 * file to ~1600×1200 / 250 KB, which is the difference between filling the
 * Railway storage volume in a week vs in a year.
 */
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

  const [data, setData] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string>("");
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

  const renderField = (f: ReportField) => {
    if (f.showIf) {
      const gateValue = data[f.showIf.key];
      if (gateValue !== f.showIf.equals) return null;
    }
    const val = data[f.key];
    switch (f.type) {
      case "boolean":
        return (
          <div key={f.key} className="space-y-1">
            <label className="block text-[13px] font-medium text-[#020040]">{f.label}</label>
            <div className="flex gap-2">
              {[true, false].map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  onClick={() => setField(f.key, b)}
                  className="px-3 py-1.5 rounded-md text-[13px] font-medium border"
                  style={
                    val === b
                      ? { background: "#020040", color: "#fff", borderColor: "#020040" }
                      : { background: "#fff", color: "#020040", borderColor: "#D8D8DD" }
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
          <div key={f.key} className="space-y-1">
            <label className="block text-[13px] font-medium text-[#020040]">{f.label}</label>
            <input
              type="number"
              min={0}
              value={typeof val === "number" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
              className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            />
          </div>
        );
      case "select":
        return (
          <div key={f.key} className="space-y-1">
            <label className="block text-[13px] font-medium text-[#020040]">{f.label}</label>
            <select
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px] bg-white"
            >
              <option value="">— Select —</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        );
      case "longtext":
        return (
          <div key={f.key} className="space-y-1">
            <label className="block text-[13px] font-medium text-[#020040]">{f.label}</label>
            {f.hint ? <p className="text-[11px] text-[#6B6B70]">{f.hint}</p> : null}
            <textarea
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              rows={3}
              className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            />
          </div>
        );
      case "text":
      default:
        return (
          <div key={f.key} className="space-y-1">
            <label className="block text-[13px] font-medium text-[#020040]">{f.label}</label>
            <input
              type="text"
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            />
          </div>
        );
    }
  };

  const renderPhotoSlot = (slot: { key: string; label: string }) => {
    const files = photos[slot.key] ?? [];
    return (
      <div key={slot.key} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-[13px] font-medium text-[#020040]">{slot.label}</label>
          <label className="cursor-pointer text-[12px] font-medium text-[#020040] underline">
            Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="sr-only"
              onChange={(e) => onPhotosChange(slot.key, e.target.files)}
            />
          </label>
        </div>
        {files.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {files.map((f, i) => {
              const url = URL.createObjectURL(f);
              return (
                <div key={`${slot.key}-${i}`} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-20 object-cover rounded border border-[#E4E4E8]" />
                  <button
                    type="button"
                    onClick={() => removePhoto(slot.key, i)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-[11px] leading-none"
                    aria-label="Remove photo"
                  >×</button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-[#6B6B70]">No photos yet</p>
        )}
      </div>
    );
  };

  const submit = async () => {
    setError(null);

    // Build payload
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

    // Build FormData with downscaled photos. Each slot becomes
    //   photos[slotKey][] entries — array of File blobs.
    const form = new FormData();
    form.set("token", token);
    form.set("template", template);
    form.set("startData", JSON.stringify(startFields));
    form.set("finalData", JSON.stringify(finalFields));

    setSubmitting(true);
    setProgress("Processing photos…");
    try {
      for (const [slot, files] of Object.entries(photos)) {
        for (let i = 0; i < files.length; i++) {
          const blob = await downscaleImage(files[i]);
          form.append(
            `photos[${slot}][]`,
            new File([blob], `${slot}-${i}.jpg`, { type: "image/jpeg" }),
          );
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

  return (
    <div className="space-y-5">
      <header className="space-y-1 pb-2 border-b border-[#E4E4E8]">
        <p className="text-[11px] uppercase tracking-wide text-[#6B6B70]">Submit report</p>
        <h2 className="text-[20px] font-semibold text-[#020040]">{jobTitle || jobReference}</h2>
        <p className="text-[12px] text-[#6B6B70]">
          {propertyAddress} · {jobReference}
          {serviceType ? ` · ${serviceType}` : ""}
        </p>
        <p className="text-[11px] text-[#6B6B70]">Template detected: <strong>{template}</strong></p>
      </header>

      {/* Start section */}
      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold text-[#020040]">On arrival</h3>
        {spec.start.map(renderField)}
        <div className="space-y-3">
          {photoSlots.start.map(renderPhotoSlot)}
        </div>
      </section>

      {/* Final section */}
      <section className="space-y-3 pt-2 border-t border-[#E4E4E8]">
        <h3 className="text-[14px] font-semibold text-[#020040]">On completion</h3>
        {spec.final.map(renderField)}
        <div className="space-y-1">
          <label className="block text-[13px] font-medium text-[#020040]">Time spent on site</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              placeholder="hours"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-24 rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            />
            <input
              type="number"
              min={0}
              max={59}
              placeholder="mins"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-24 rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            />
          </div>
        </div>
        <div className="space-y-3">
          {photoSlots.final.map(renderPhotoSlot)}
        </div>
      </section>

      {error ? (
        <div className="rounded-md bg-[#FFF1EB] border border-[#F5CFB8] p-3 text-[12px] text-[#7A3D00]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-[14px] font-semibold disabled:opacity-50"
        style={{ background: "#020040", color: "#fff" }}
      >
        {submitting ? (progress || "Submitting…") : "Submit report"}
      </button>
    </div>
  );
}
