"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, FileCheck, Calendar, Upload, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listAccounts } from "@/services/accounts";
import { listAccountProperties } from "@/services/account-properties";
import {
  createAccountComplianceCertificate,
  deleteAccountComplianceCertificate,
  getComplianceCertSignedUrl,
  listAccountComplianceCertificates,
  uploadComplianceCertDoc,
} from "@/services/account-compliance-certificates";
import type {
  Account,
  AccountComplianceCertificate,
  AccountProperty,
  ComplianceCertificateStatus,
  ComplianceCertificateType,
} from "@/types/database";

const CERT_TYPES: { value: ComplianceCertificateType; label: string }[] = [
  { value: "gas_safe",    label: "Gas Safe" },
  { value: "eicr",        label: "EICR" },
  { value: "epc",         label: "EPC" },
  { value: "pat",         label: "PAT Testing" },
  { value: "fire_safety", label: "Fire Safety" },
  { value: "legionella",  label: "Legionella" },
  { value: "asbestos",    label: "Asbestos" },
  { value: "other",       label: "Other" },
];

const STATUS_BADGE: Record<ComplianceCertificateStatus, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
  ok:       { label: "Compliant", variant: "success" },
  expiring: { label: "Expiring",  variant: "warning" },
  expired:  { label: "Expired",   variant: "danger"  },
  missing:  { label: "Missing",   variant: "default" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function daysLeftFromExpiry(expiry: string): number {
  const e = new Date(`${expiry}T00:00:00`);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((e.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
}

export default function CompliancePage() {
  const [rows, setRows] = useState<AccountComplianceCertificate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ComplianceCertificateStatus>("");

  // Drawer state for new cert
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAccountComplianceCertificates({
        page: 1,
        pageSize: 200,
        search: debouncedSearch.trim() || undefined,
        accountId: accountId.trim() || undefined,
        status: statusFilter || undefined,
      });
      setRows(res.data);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, accountId, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listAccounts({ page: 1, pageSize: 500 });
        if (!cancelled) setAccounts(r.data);
      } catch {
        if (!cancelled) setAccounts([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const accountMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.company_name);
    return m;
  }, [accounts]);

  async function handleViewDoc(path: string | null | undefined) {
    if (!path) {
      toast.error("No document attached.");
      return;
    }
    const url = await getComplianceCertSignedUrl(path);
    if (!url) {
      toast.error("Could not load document.");
      return;
    }
    window.open(url, "_blank", "noreferrer,noopener");
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this certificate? This is reversible from SQL but not from the UI.")) return;
    try {
      await deleteAccountComplianceCertificate(id);
      toast.success("Certificate removed.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Compliance Certificates"
          subtitle="Per-property certificates (Gas Safe, EICR, PAT, Fire Safety) shown to portal users in their PropertyDrawer → Compliance tab."
        >
          <Button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center justify-center rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            <Plus className="w-4 h-4 mr-2" />
            Register certificate
          </Button>
        </PageHeader>

        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            placeholder="Search type, notes…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-md"
          />
          <Select
            label=""
            className="sm:w-72"
            options={[
              { value: "", label: "All accounts" },
              ...accounts.map((a) => ({ value: a.id, label: a.company_name })),
            ]}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
          <Select
            label=""
            className="sm:w-48"
            options={[
              { value: "", label: "Any status" },
              { value: "ok", label: "Compliant" },
              { value: "expiring", label: "Expiring" },
              { value: "expired", label: "Expired" },
              { value: "missing", label: "Missing" },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | ComplianceCertificateStatus)}
          />
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm text-text-tertiary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <FileCheck className="w-10 h-10 mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary text-sm">No certificates registered yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {rows.map((c) => {
                const days = daysLeftFromExpiry(c.expiry_date);
                const badge = STATUS_BADGE[c.status];
                const accountName = accountMap.get(c.account_id) ?? "—";
                const typeLabel = CERT_TYPES.find((t) => t.value === c.certificate_type)?.label ?? c.certificate_type;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-secondary/80"
                  >
                    <div className="min-w-0 flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <FileCheck className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-text-primary truncate">
                          {typeLabel} · {accountName}
                        </p>
                        <p className="text-xs text-text-tertiary line-clamp-1">
                          {c.notes ?? "—"}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                          <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                          <span className="text-xs text-text-tertiary flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Expires {formatDate(c.expiry_date)}
                            <span className={
                              days < 0 ? "text-red-500" :
                              days < 30 ? "text-amber-500" : "text-text-tertiary"
                            }>
                              {" · "}{days < 0 ? `${Math.abs(days)}d ago` : `${days}d left`}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.document_path && (
                        <Button variant="outline" size="sm" onClick={() => void handleViewDoc(c.document_path)}>
                          View doc
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDelete(c.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <NewCertDrawer
          open={drawerOpen}
          accounts={accounts}
          onClose={() => setDrawerOpen(false)}
          onCreated={() => { setDrawerOpen(false); void load(); }}
        />
      </div>
    </PageTransition>
  );
}

function NewCertDrawer({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<AccountProperty[]>([]);
  const [certType, setCertType] = useState<ComplianceCertificateType>("gas_safe");
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);

  // Reset state when drawer opens.
  useEffect(() => {
    if (open) {
      setAccountId("");
      setPropertyId("");
      setProperties([]);
      setCertType("gas_safe");
      setIssuedDate("");
      setExpiryDate("");
      setNotes("");
      setFile(null);
    }
  }, [open]);

  // Load properties for the selected account.
  useEffect(() => {
    if (!accountId) { setProperties([]); setPropertyId(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await listAccountProperties({ page: 1, pageSize: 200, accountId });
        if (!cancelled) setProperties(r.data);
      } catch {
        if (!cancelled) setProperties([]);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const canSubmit = accountId.trim().length > 0 && expiryDate.trim().length > 0 && !pending;

  async function submit() {
    if (!canSubmit) return;
    setPending(true);
    try {
      // 1. Insert the cert row first to get an id.
      const created = await createAccountComplianceCertificate({
        account_id:       accountId,
        property_id:      propertyId || null,
        certificate_type: certType,
        issued_date:      issuedDate || null,
        expiry_date:      expiryDate,
        notes:            notes || null,
      });

      // 2. Upload the doc (if provided) and patch the row with the path.
      if (file) {
        const path = await uploadComplianceCertDoc(accountId, created.id, file);
        const supabase = (await import("@/services/base")).getSupabase();
        await supabase
          .from("account_compliance_certificates")
          .update({ document_path: path })
          .eq("id", created.id);
      }

      toast.success("Certificate registered.");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save certificate.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Register compliance certificate"
      subtitle="The portal user gets a real-time notification when the cert flips to expiring or expired."
      width="w-[520px]"
      footer={
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-light bg-card">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? "Saving…" : "Register"}
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Account *</label>
          <Select
            label=""
            options={[
              { value: "", label: "— pick an account —" },
              ...accounts.map((a) => ({ value: a.id, label: a.company_name })),
            ]}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Property</label>
          <Select
            label=""
            options={[
              { value: "", label: properties.length > 0 ? "Account-wide (no specific property)" : "Pick an account first" },
              ...properties.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={!accountId}
          />
          <p className="text-[11px] text-text-tertiary">Leave blank for account-wide certificates (e.g. group-level Fire Safety).</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Certificate type *</label>
          <Select
            label=""
            options={CERT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            value={certType}
            onChange={(e) => setCertType(e.target.value as ComplianceCertificateType)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary">Issued</label>
            <Input
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary">Expires *</label>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Inspection report ref, issuing body, etc."
            className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Document</label>
          <label
            htmlFor="cert-doc"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border cursor-pointer hover:border-primary/40"
          >
            <Upload className="w-4 h-4 text-text-tertiary" />
            <span className="text-sm text-text-secondary">
              {file ? file.name : "PDF or image (max 20 MB)"}
            </span>
          </label>
          <input
            id="cert-doc"
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
    </Drawer>
  );
}
