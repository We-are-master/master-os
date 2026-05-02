"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/property-types";

export function PortalNewAssetClient({
  accountName,
  contacts,
}: {
  accountName: string;
  contacts: Array<{ id: string; full_name: string; email?: string | null }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !fullAddress.trim() || !propertyType.trim()) {
      setError("Name, address, and property type are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          fullAddress: fullAddress.trim(),
          propertyType: propertyType.trim(),
          primaryContactId: primaryContactId.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; property?: { id: string } };
      if (!res.ok || !payload.property?.id) {
        setError(typeof payload.error === "string" ? payload.error : "Could not save.");
        setSaving(false);
        return;
      }
      router.push(`/portal/assets/${payload.property.id}`);
      router.refresh();
    } catch {
      setError("Could not save. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/portal/assets"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to assets
      </Link>

      <div>
        <h1 className="text-2xl font-black text-text-primary">Add property</h1>
        <p className="text-sm text-text-secondary mt-1">
          Linked account: <span className="font-semibold text-text-primary">{accountName}</span>
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-6 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
            Property name *
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Site or building name" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
            Full address *
          </label>
          <Input
            value={fullAddress}
            onChange={(e) => setFullAddress(e.target.value)}
            placeholder="Operational address"
          />
        </div>

        <Select
          label="Property type *"
          options={[{ value: "", label: "Select…" }, ...PROPERTY_TYPE_OPTIONS.map((t) => ({ value: t, label: t }))]}
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
        />

        <Select
          label="Primary site contact (optional)"
          options={[
            { value: "", label: contacts.length ? "None" : "Add contacts in Fixfy OS first" },
            ...contacts.map((c) => ({
              value: c.id,
              label: c.full_name + (c.email ? ` (${c.email})` : ""),
            })),
          ]}
          value={primaryContactId}
          onChange={(e) => setPrimaryContactId(e.target.value)}
          disabled={contacts.length === 0}
        />

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
            Site phone
          </label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm min-h-[88px]"
            placeholder="Access, parking, hazards…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/portal/assets"
            className="px-5 py-2.5 rounded-xl border-2 border-border text-text-primary font-semibold text-sm"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-orange-600 hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save property"}
          </button>
        </div>
      </form>
    </div>
  );
}
