"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const ORANGE = "#ED4B00";
// Deep navy → ember diagonal, matching the partner on-hold email header.
const BG_GRADIENT = "linear-gradient(155deg,#01001F 0%,#050048 48%,#7A1E00 100%)";
const HEADER_GRADIENT = "linear-gradient(135deg,#020034 0%,#0A0A4A 100%)";

const MAX_PHOTO_LONG_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.75;
const MAX_PHOTOS = 12;
const SUPPORT_PHONE = "+44 20 4538 4668";
const SUPPORT_PHONE_HREF = "+442045384668";
const SUPPORT_EMAIL = "support@getfixfy.com";

interface JobInfo {
  jobReference: string;
  jobTitle: string | null;
  propertyAddress: string | null;
  onHoldReason: string | null;
  isOnHold: boolean;
  alreadySubmitted: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; info: JobInfo }
  | { kind: "done"; jobReference: string; photos: number }
  | { kind: "error"; message: string };

/** Client-side downscale → JPEG (keeps uploads small, mirrors the report form). */
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
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encode failed."))), "image/jpeg", PHOTO_JPEG_QUALITY);
  });
  bitmap.close();
  return blob;
}

function friendlyError(code?: string): string {
  switch (code) {
    case "missing_token":
    case "invalid_or_expired_token":
      return "This link is invalid or has expired. Please open the most recent on-hold email.";
    case "partner_mismatch":
      return "This link is for a different partner. Ask the office for an updated link.";
    case "job_not_found":
      return "We couldn't find this job. Please contact support.";
    default:
      return "Something went wrong loading this job. Please try again.";
  }
}

/** White Fixfy wordmark — designed for dark/navy surfaces. */
function Wordmark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logos/fixfy-wordmark.png" alt="Fixfy" className={className} />;
}

export function OnHoldClient() {
  const search = useSearchParams();
  const token = search.get("token");

  const [state, setState] = useState<State>({ kind: "loading" });
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: friendlyError("missing_token") });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/on-hold-info?token=${encodeURIComponent(token)}`);
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !j?.ok) {
          setState({ kind: "error", message: friendlyError(j?.error) });
          return;
        }
        setState({ kind: "ready", info: j as JobInfo });
      } catch {
        if (!cancelled) setState({ kind: "error", message: friendlyError() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const previews = useMemo(() => photos.map((f) => ({ url: URL.createObjectURL(f), name: f.name })), [photos]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotos((prev) => [...prev, ...Array.from(files)].slice(0, MAX_PHOTOS));
  };
  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    setFormError(null);
    if (!token) return;
    if (!notes.trim()) {
      setFormError("Please add a short summary of how you can resolve this.");
      return;
    }
    setSubmitting(true);
    setProgress(photos.length ? "Processing photos…" : "Sending…");
    try {
      const form = new FormData();
      form.set("token", token);
      form.set("notes", notes.trim());
      for (let i = 0; i < photos.length; i++) {
        const blob = await downscaleImage(photos[i]);
        form.append("photos[]", new File([blob], `photo-${i + 1}.jpg`, { type: "image/jpeg" }));
      }
      setProgress("Sending your update…");
      const res = await fetch("/api/jobs/on-hold-submit", { method: "POST", body: form });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; jobReference?: string; photosUploaded?: number } | null;
      if (!res.ok || !j?.ok) {
        setFormError(j?.error ?? "Could not send your update. Please try again.");
        return;
      }
      setState({ kind: "done", jobReference: j.jobReference ?? "", photos: j.photosUploaded ?? 0 });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unexpected error. Please try again.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-12"
      style={{ background: BG_GRADIENT }}
    >
      {/* Standalone wordmark above the card for brand presence */}
      <Wordmark className="h-6 w-auto opacity-95 mb-6 select-none" />

      <div className="w-full max-w-lg overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_-12px_rgba(2,0,52,0.55)] ring-1 ring-white/10">
        {/* Brand header */}
        <div className="relative px-7 pt-7 pb-6 text-center" style={{ background: HEADER_GRADIENT }}>
          {/* subtle ember glow, top-right */}
          <div
            className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-40 blur-2xl"
            style={{ background: ORANGE }}
            aria-hidden
          />
          <div className="relative flex flex-col items-center">
            <Wordmark className="h-7 w-auto" />
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-200 ring-1 ring-inset ring-white/15">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" /> Job on hold
            </span>
          </div>
        </div>

        <div className="p-7">
          {state.kind === "loading" && (
            <div className="py-14 text-center">
              <div className="mx-auto mb-5 h-11 w-11 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500" />
              <p className="text-sm text-slate-500">Loading your job…</p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">⚠️</div>
              <h1 className="text-lg font-bold text-slate-800">We couldn&apos;t open this link</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{state.message}</p>
              <p className="mt-6 text-xs text-slate-400">
                Need a hand? Email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium" style={{ color: ORANGE }}>
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
          )}

          {state.kind === "done" && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl ring-8 ring-emerald-50/60">✅</div>
              <h1 className="text-xl font-bold text-slate-900">Thank you — that&apos;s with our team</h1>
              <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-slate-500">
                We&apos;ve received your update{state.photos > 0 ? ` and ${state.photos} photo${state.photos === 1 ? "" : "s"}` : ""} for job{" "}
                <strong className="text-slate-700">{state.jobReference}</strong>. Our team will review it and get back to you — and release your payment once the case is resolved.
              </p>
            </div>
          )}

          {state.kind === "ready" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-[22px] font-bold leading-snug tracking-[-0.01em] text-slate-900">
                  A complaint was raised — help us put it right
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  A complaint has come in about the job below, so it&apos;s on hold while we look into it. Send us a quick summary and a few photos and we&apos;ll work to resolve it for the customer.
                </p>
              </div>

              {/* Payment-on-hold notice */}
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <span className="mt-0.5 text-base leading-none">💰</span>
                <p className="text-[13px] leading-relaxed text-red-800">
                  <strong className="text-red-700">Your payment for this job is on hold</strong> until we receive your evidence and close the case. The sooner you reply, the sooner it&apos;s released.
                </p>
              </div>

              {/* Job context */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Job #{state.info.jobReference}</p>
                <p className="mt-1 text-[15px] font-semibold text-slate-800">{state.info.jobTitle || "Maintenance job"}</p>
                {state.info.propertyAddress && (
                  <p className="mt-1 text-[13px] leading-snug text-slate-500">{state.info.propertyAddress}</p>
                )}
                {state.info.onHoldReason && (
                  <div className="mt-3 rounded-lg border-l-[3px] border-amber-400 bg-amber-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">What the customer reported</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-amber-900 whitespace-pre-wrap">{state.info.onHoldReason}</p>
                  </div>
                )}
              </div>

              {state.info.alreadySubmitted && (
                <div className="rounded-lg bg-blue-50 px-3.5 py-2.5 text-[13px] text-blue-800">
                  You&apos;ve already sent an update for this job. You can add more details or photos below if needed.
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-slate-700">
                  What happened / how can you resolve it? <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={5}
                  placeholder="Tell us what was done, what the issue is, and how you can put it right…"
                  className="w-full resize-y rounded-xl border border-slate-300 px-3.5 py-3 text-[14px] text-slate-800 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                />
              </div>

              {/* Photos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-semibold text-slate-700">Photos & evidence</label>
                  <span className="text-[11px] text-slate-400">{photos.length}/{MAX_PHOTOS}</span>
                </div>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-center transition hover:border-orange-300 hover:bg-orange-50/40">
                  <span className="text-2xl">📷</span>
                  <span className="text-[13px] font-medium text-slate-600">Tap to add photos</span>
                  <span className="text-[11px] text-slate-400">Work area, completed work, receipts, certificates…</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="sr-only"
                    disabled={photos.length >= MAX_PHOTOS}
                    onChange={(e) => addPhotos(e.target.files)}
                  />
                </label>
                {previews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {previews.map((p, i) => (
                      <div key={`${p.name}-${i}`} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-20 w-full rounded-lg border border-slate-200 object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-[12px] leading-none text-white"
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{formError}</div>
              )}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="w-full rounded-xl px-4 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(237,75,0,0.6)] transition hover:brightness-[1.04] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: `linear-gradient(135deg,${ORANGE} 0%,#FF7A29 100%)` }}
              >
                {submitting ? progress || "Sending…" : "Send update to Fixfy"}
              </button>
              <p className="text-center text-[11px] leading-relaxed text-slate-400">
                No app or login needed. Need to talk it through? Call{" "}
                <a href={`tel:${SUPPORT_PHONE_HREF}`} className="font-medium" style={{ color: ORANGE }}>
                  {SUPPORT_PHONE}
                </a>
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="mt-6 text-center text-[11px] text-white/40">
        © Fixfy · <span style={{ color: "rgba(255,255,255,0.55)" }}>getfixfy.com</span>
      </p>
    </div>
  );
}
