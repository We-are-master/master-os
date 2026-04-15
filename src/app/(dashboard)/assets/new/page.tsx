"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/property-types";
import { listAccounts } from "@/services/accounts";
import { createAccountProperty } from "@/services/account-properties";
import { listContactsForAccount } from "@/services/clients";
import { logAudit } from "@/services/audit";
import type { Account } from "@/types/database";
import type { Client } from "@/types/database";
import { useProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function NewAssetPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Client[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listAccounts({ page: 1, pageSize: 500 }).then((r) => setAccounts(r.data));
  }, []);

  useEffect(() => {
    if (!accountId) {
      setContacts([]);
      setPrimaryContactId("");
      return;
    }
    void listContactsForAccount(accountId).then(setContacts).catch(() => setContacts([]));
  }, [accountId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId.trim()) {
      toast.error("Link the property to an account.");
      return;
    }
    if (!name.trim() || !fullAddress.trim() || !propertyType.trim()) {
      toast.error("Name, full address, and property type are required.");
      return;
    }
    setSaving(true);
    try {
      const row = await createAccountProperty({
        account_id: accountId.trim(),
        name: name.trim(),
        full_address: fullAddress.trim(),
        property_type: propertyType.trim(),
        primary_contact_id: primaryContactId.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      });
      await logAudit({
        entityType: "property",
        entityId: row.id,
        entityRef: row.name,
        action: "created",
        userId: profile?.id,
        userName: profile?.full_name,
        metadata: { account_id: row.account_id },
      });
      toast.success("Property created");
      router.push(`/assets/${row.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create property");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageTransition>
      <div className="max-w-2xl space-y-6">
        <Link
          href="/assets"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to assets
        </Link>

        <PageHeader
          title="Add property"
          subtitle="Register a physical site under a client account. Contacts for the site manager are chosen from that account."
        />

        <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-6 space-y-5">
          <Select
            label="Linked account *"
            options={[
              { value: "", label: "Select account…" },
              ...accounts.map((a) => ({ value: a.id, label: a.company_name })),
            ]}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          />

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Property name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fleet Street office" />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Full address *</label>
            <Input
              value={fullAddress}
              onChange={(e) => setFullAddress(e.target.value)}
              placeholder="Street, city, postcode"
            />
          </div>

          <Select
            label="Property type *"
            options={[{ value: "", label: "Select…" }, ...PROPERTY_TYPE_OPTIONS.map((t) => ({ value: t, label: t }))]}
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value)}
            required
          />

          <Select
            label="Primary site contact / manager (optional)"
            options={[
              { value: "", label: contacts.length ? "None" : "No contacts on this account yet" },
              ...contacts.map((c) => ({ value: c.id, label: c.full_name + (c.email ? ` (${c.email})` : "") })),
            ]}
            value={primaryContactId}
            onChange={(e) => setPrimaryContactId(e.target.value)}
            disabled={!accountId || contacts.length === 0}
          />

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Site phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm min-h-[88px]"
              placeholder="Access instructions, hazards, parking…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.push("/assets")}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create property"}
            </Button>
          </div>
        </form>
      </div>
    </PageTransition>
  );
}
