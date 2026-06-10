"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  onPhotoChange?: (url: string | null) => void;
  onLinkedChange?: (linked: boolean) => void;
};

/** Upload control for workforce users linked to payroll_internal_costs. */
export function WorkforceProfilePhoto({ onPhotoChange, onLinkedChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [hasWorkforce, setHasWorkforce] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workforce/profile-photo", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not load photo");
      const linked = Boolean(data.hasWorkforce);
      setHasWorkforce(linked);
      onLinkedChange?.(linked);
      const url = typeof data.photoUrl === "string" ? data.photoUrl : null;
      setPhotoUrl(url);
      onPhotoChange?.(url);
    } catch {
      setHasWorkforce(false);
      onLinkedChange?.(false);
      setPhotoUrl(null);
      onPhotoChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onLinkedChange, onPhotoChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/workforce/profile-photo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const url = typeof data.photoUrl === "string" ? data.photoUrl : null;
      setPhotoUrl(url);
      onPhotoChange?.(url);
      toast.success("Profile photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (loading || !hasWorkforce) return null;

  return (
    <div className="mb-4">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={uploading}
        icon={
          uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />
        }
        onClick={() => inputRef.current?.click()}
      >
        {photoUrl ? "Change profile photo" : "Add profile photo"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <p className="text-[11px] text-text-tertiary mt-1.5">
        JPEG, PNG or WebP · max 10 MB. Visible on your workforce roster.
      </p>
    </div>
  );
}
