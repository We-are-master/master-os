"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type BrandingImageKind = "pdf-logo" | "favicon" | "email-header" | "sidebar-dark" | "sidebar-light";

interface BrandingImageUploadProps {
  /** Logical kind — drives the upload path under the bucket. */
  kind: BrandingImageKind;
  /** Current public URL (controlled by parent). */
  value: string;
  onChange: (url: string) => void;
  /** Inline label rendered above the field. */
  label: string;
  /** Optional helper text. */
  description?: string;
  /** Optional placeholder for the URL input fallback. */
  placeholder?: string;
  /** Tailwind class for the preview tile size (e.g. "h-12" for tall logos, "h-10 w-10" for favicon). */
  previewClass?: string;
}

/**
 * Dual-mode branding upload: file picker (uploads to the
 * `company-branding` Supabase bucket) OR paste a URL manually.
 * Successful uploads overwrite the parent's URL field.
 */
export function BrandingImageUpload({
  kind,
  value,
  onChange,
  label,
  description,
  placeholder,
  previewClass = "h-10 w-auto",
}: BrandingImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File is too large (max 5 MB)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/admin/branding/upload", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !json.ok || !json.url) {
        throw new Error(json.error ?? "Upload failed");
      }
      onChange(json.url);
      toast.success("Image uploaded — don't forget to save settings");
    } catch (err) {
      console.error("[branding-upload]", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
      {description ? (
        <p className="text-[11px] text-text-tertiary leading-snug mb-2">{description}</p>
      ) : null}

      <div className="flex items-stretch gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "https://…/image.png"}
          className="flex-1"
          disabled={uploading}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            disabled={uploading}
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5 text-text-tertiary" />
          </Button>
        ) : null}
      </div>

      {value ? (
        <div className="mt-2 p-3 rounded-xl bg-surface-hover border border-border-light flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={`${label} preview`}
            className={`${previewClass} object-contain`}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[11px] text-text-tertiary">Save settings to apply.</span>
        </div>
      ) : null}
    </div>
  );
}
