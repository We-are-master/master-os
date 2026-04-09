"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Lock } from "lucide-react";
import type { PortalAccountSettings } from "@/lib/server-fetchers/portal-account";

interface PortalSettingsClientProps {
  account: PortalAccountSettings;
  portalUser: {
    email:     string;
    full_name: string | null;
  };
}

export function PortalSettingsClient({ account, portalUser }: PortalSettingsClientProps) {
  const router = useRouter();
  const [contactName,   setContactName]   = useState(account.contact_name ?? "");
  const [financeEmail,  setFinanceEmail]  = useState(account.finance_email ?? "");
  const [contactNumber, setContactNumber] = useState(account.contact_number ?? "");
  const [address,       setAddress]       = useState(account.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!contactName.trim()) {
      setError("Contact name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/account", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          contact_name:   contactName.trim(),
          finance_email:  financeEmail.trim(),
          contact_number: contactNumber.trim(),
          address:        address.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "We could not save your changes.");
        setSaving(false);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      console.error("[portal/settings] save error:", err);
      setError("We could not save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-text-primary">Account settings</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage how the Master team reaches you and where invoices are sent.
        </p>
      </div>

      {/* Editable fields */}
      <form onSubmit={handleSubmit}>
        <div className="bg-card rounded-2xl border border-border p-6 lg:p-8 space-y-5">
          <h2 className="text-base font-bold text-text-primary">Contact details</h2>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 rounded-xl px-4 py-3 text-sm">
              Saved.
            </div>
          )}

          <Field label="Contact name" required>
            <input
              type="text"
              className={inputCls}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={saving}
              maxLength={200}
            />
          </Field>

          <Field label="Finance email" hint="Where invoices and payment receipts will be sent.">
            <input
              type="text"
              className={inputCls}
              value={financeEmail}
              onChange={(e) => setFinanceEmail(e.target.value)}
              placeholder="finance@yourcompany.com"
              disabled={saving}
              maxLength={200}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </Field>

          <Field label="Phone number">
            <input
              type="text"
              className={inputCls}
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="+44 20 1234 5678"
              disabled={saving}
              maxLength={60}
            />
          </Field>

          <Field label="Billing address">
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Your business address"
              disabled={saving}
              maxLength={500}
            />
          </Field>

          <div className="flex items-center justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition-colors disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </form>

      {/* Read-only fields — managed by Master */}
      <div className="bg-card rounded-2xl border border-border p-6 lg:p-8 space-y-5">
        <div>
          <h2 className="text-base font-bold text-text-primary">Account profile</h2>
          <p className="text-xs text-text-tertiary mt-1 flex items-center gap-1.5">
            <Lock className="w-3 h-3" />
            Managed by the Master team. Email{" "}
            <a href="mailto:hello@wearemaster.com" className="text-orange-600 font-medium">
              hello@wearemaster.com
            </a>{" "}
            to change these.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <ReadOnlyField label="Company name" value={account.company_name} />
          <ReadOnlyField label="Account email" value={account.email} />
          <ReadOnlyField label="Industry" value={account.industry || "—"} />
          <ReadOnlyField label="Payment terms" value={account.payment_terms || "—"} />
        </div>
      </div>

      {/* Signed-in user */}
      <div className="bg-card rounded-2xl border border-border p-6 lg:p-8">
        <h2 className="text-base font-bold text-text-primary mb-4">Signed in as</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 flex items-center justify-center font-bold text-lg shrink-0">
            {(portalUser.full_name?.[0] ?? portalUser.email[0]).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">
              {portalUser.full_name || portalUser.email}
            </p>
            <p className="text-xs text-text-tertiary truncate">{portalUser.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition";

interface FieldProps { label: string; required?: boolean; hint?: string; children: React.ReactNode }
function Field({ label, required, hint, children }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-text-tertiary mt-1.5">{hint}</p>}
    </div>
  );
}

interface ReadOnlyFieldProps { label: string; value: string }
function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm font-semibold text-text-primary truncate">{value}</p>
    </div>
  );
}
