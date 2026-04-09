"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { compressImage, sanitizeFileForUpload } from "@/lib/upload-helpers";
import { TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";

const MAX_IMAGES = 6;

export function NewRequestClient() {
  const router = useRouter();
  const [serviceType,    setServiceType]    = useState("");
  const [description,    setDescription]    = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [desiredDate,    setDesiredDate]    = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAddImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_IMAGES - images.length;
    const accepted  = files.slice(0, remaining);
    setImages((prev) => [...prev, ...accepted]);
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
      form.append("serviceType",     serviceType.trim());
      form.append("description",     description.trim());
      form.append("propertyAddress", propertyAddress.trim());
      if (desiredDate.trim()) form.append("desiredDate", desiredDate.trim());

      compressed.forEach((file, idx) => {
        form.append("images", sanitizeFileForUpload(file, `image_${idx + 1}`));
      });

      const res = await fetch("/api/portal/requests", {
        method: "POST",
        body:   form,
        headers: { Accept: "application/json" },
      });

      let payload: { ok?: boolean; error?: unknown; reference?: string } = {};
      try { payload = await res.json(); } catch { /* ignore */ }

      if (!res.ok) {
        const apiErr = typeof payload.error === "string" ? payload.error : "";
        setError(apiErr || "We could not submit your request. Please try again.");
        setSubmitting(false);
        return;
      }

      // Success — bounce back to the list. The new request will appear at the top.
      router.push("/portal/requests");
      router.refresh();
    } catch (err) {
      console.error("[portal/requests/new] submit error:", err);
      setError("We could not submit your request. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/portal/requests"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to requests
      </Link>

      <div className="bg-card rounded-2xl border border-border p-6 lg:p-8">
        <h1 className="text-2xl font-black text-text-primary mb-1">New service request</h1>
        <p className="text-sm text-text-secondary mb-6">
          Tell us what you need and our team will respond with a quote.
        </p>

        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Service type <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
              rows={5}
              placeholder="Tell us what needs doing — the more detail you give, the faster we can quote."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Property address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
              placeholder="123 Example Street, London, SW1A 1AA"
              value={propertyAddress}
              onChange={(e) => setPropertyAddress(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
              Desired date <span className="text-text-tertiary font-normal normal-case">(optional)</span>
            </label>
            <input
              type="date"
              className="w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
              value={desiredDate}
              onChange={(e) => setDesiredDate(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
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
              <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed border-border bg-surface-secondary hover:border-orange-300 hover:bg-orange-50/30 cursor-pointer transition-colors">
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

          <div className="flex items-center justify-end gap-3 pt-4">
            <Link
              href="/portal/requests"
              className="px-5 py-2.5 rounded-xl border-2 border-border text-text-primary font-semibold text-sm hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60 bg-orange-600"
            >
              {submitting ? "Submitting..." : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
