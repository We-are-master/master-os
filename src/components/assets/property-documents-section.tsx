"use client";

import { useState, useRef } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/services/base";
import type { AccountPropertyDocument } from "@/types/database";
import { toast } from "sonner";

const BUCKET = "account-property-docs";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export function PropertyDocumentsSection({
  propertyId,
  accountId,
  initialDocuments,
}: {
  propertyId: string;
  accountId: string;
  initialDocuments: AccountPropertyDocument[];
}) {
  const [docs, setDocs] = useState<AccountPropertyDocument[]>(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const supabase = getSupabase();
      const path = `${accountId}/${propertyId}/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (upErr) {
        toast.error(upErr.message || "Upload failed");
        return;
      }
      const { data: row, error: insErr } = await supabase
        .from("account_property_documents")
        .insert({
          property_id: propertyId,
          file_name: file.name,
          storage_path: path,
          uploaded_by: "dashboard",
        })
        .select()
        .single();
      if (insErr || !row) {
        toast.error(insErr?.message ?? "Could not save document row");
        return;
      }
      setDocs((d) => [row as AccountPropertyDocument, ...d]);
      toast.success("Document uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function downloadDoc(doc: AccountPropertyDocument) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 120);
    if (error || !data?.signedUrl) {
      toast.error("Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-text-primary">Documents</h2>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={onFile}
            disabled={uploading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-text-tertiary">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {docs.map((d) => (
            <li key={d.id} className="py-2 flex justify-between gap-2 text-sm items-center">
              <span className="truncate font-medium text-text-primary">{d.file_name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void downloadDoc(d)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
