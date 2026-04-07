"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

type PartnerInfo = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  trade: string | null;
  trades: string[] | null;
  partner_address: string | null;
  uk_coverage_regions: string[] | null;
  vat_number: string | null;
  vat_registered: boolean | null;
  crn: string | null;
  utr: string | null;
  partner_legal_type: string | null;
};

type ExistingDoc = {
  id: string;
  name: string;
  doc_type: string;
  status: string;
  file_name: string | null;
  expires_at: string | null;
  created_at: string;
};

type RequestInfo = {
  id: string;
  requestedDocTypes: string[];
  customMessage: string | null;
  expiresAt: string;
};

type InfoResponse = {
  request: RequestInfo;
  partner: PartnerInfo;
  documents: ExistingDoc[];
};

const DOC_TYPE_OPTIONS = [
  { value: "insurance", label: "Insurance" },
  { value: "certification", label: "Certification" },
  { value: "license", label: "License" },
  { value: "contract", label: "Contract" },
  { value: "tax", label: "Tax" },
  { value: "id_proof", label: "ID Proof" },
  { value: "other", label: "Other" },
];

const STATUS_BADGE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-stone-200 text-stone-700",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function PartnerUploadContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoResponse | null>(null);

  // Profile form state
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [vatRegistered, setVatRegistered] = useState(false);
  const [crn, setCrn] = useState("");
  const [utr, setUtr] = useState("");
  const [tradesInput, setTradesInput] = useState("");
  const [regionsInput, setRegionsInput] = useState("");
  const [bankSort, setBankSort] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [bankName, setBankName] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Upload form state
  const [docType, setDocType] = useState("insurance");
  const [docName, setDocName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadInfo = useCallback(() => {
    if (!token) {
      setLoading(false);
      setLoadError("Missing token. Use the link from your email.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    fetch(`/api/partner-upload/info?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setLoadError(data.error ?? "Could not load this link.");
          setInfo(null);
          return;
        }
        const i = data as InfoResponse;
        setInfo(i);
        const p = i.partner;
        setContactName(p.contact_name ?? "");
        setPhone(p.phone ?? "");
        setAddress(p.partner_address ?? "");
        setVatNumber(p.vat_number ?? "");
        setVatRegistered(Boolean(p.vat_registered));
        setCrn(p.crn ?? "");
        setUtr(p.utr ?? "");
        setTradesInput((p.trades ?? []).join(", "));
        setRegionsInput((p.uk_coverage_regions ?? []).join(", "));
        if (i.request.requestedDocTypes && i.request.requestedDocTypes.length > 0) {
          setDocType(i.request.requestedDocTypes[0]);
        }
      })
      .catch(() => setLoadError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const trades = tradesInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const regions = regionsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const patch: Record<string, unknown> = {
        contact_name: contactName,
        phone,
        partner_address: address,
        vat_number: vatNumber,
        vat_registered: vatRegistered,
        crn,
        utr,
        trades,
        uk_coverage_regions: regions,
      };
      if (bankSort.trim()) patch.bank_sort_code = bankSort;
      if (bankAccount.trim()) patch.bank_account_number = bankAccount;
      if (bankHolder.trim()) patch.bank_account_holder = bankHolder;
      if (bankName.trim()) patch.bank_name = bankName;

      const res = await fetch("/api/partner-upload/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ type: "err", text: data.error ?? "Failed to save profile." });
        return;
      }
      setProfileMsg({ type: "ok", text: "Profile updated. Thank you!" });
      // Clear bank fields after save (write-only surface)
      setBankSort("");
      setBankAccount("");
      setBankHolder("");
      setBankName("");
    } catch {
      setProfileMsg({ type: "err", text: "Network error. Please try again." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("token", token);
      fd.append("file", file);
      fd.append("docType", docType);
      fd.append("name", docName.trim() || file.name);
      const res = await fetch("/api/partner-upload/file", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg({ type: "err", text: data.error ?? "Upload failed." });
        return;
      }
      setUploadMsg({ type: "ok", text: "Document uploaded. Thank you!" });
      setFile(null);
      setDocName("");
      // Refresh document list
      loadInfo();
    } catch {
      setUploadMsg({ type: "err", text: "Network error. Please try again." });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-stone-500">Loading...</div>
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <h1 className="text-xl font-bold text-stone-800">Link unavailable</h1>
          <p className="text-stone-600 mt-2">{loadError ?? "This link cannot be used."}</p>
          <p className="text-stone-500 mt-4 text-sm">
            If you believe this is a mistake, please contact us and we will issue a new link.
          </p>
        </div>
      </div>
    );
  }

  const partnerName =
    info.partner.contact_name?.trim() || info.partner.company_name?.trim() || "there";
  const requestedTypes = info.request.requestedDocTypes ?? [];

  return (
    <div className="min-h-screen bg-stone-100 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow border border-stone-200 p-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">
            Document & profile update
          </p>
          <h1 className="text-2xl font-bold text-stone-900 mt-1">Hi {partnerName},</h1>
          <p className="text-stone-600 mt-2">
            We need a few details from you. Please review the information below, update anything
            that has changed, and upload any requested documents.
          </p>
          {info.request.customMessage ? (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900 whitespace-pre-wrap">
              {info.request.customMessage}
            </div>
          ) : null}
          {requestedTypes.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Documents requested
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {requestedTypes.map((t) => (
                  <span
                    key={t}
                    className="text-xs font-medium bg-orange-100 text-orange-800 px-2.5 py-1 rounded-full"
                  >
                    {DOC_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-stone-500 mt-4">
            This link expires on <strong>{formatDate(info.request.expiresAt)}</strong>.
          </p>
        </div>

        {/* Existing documents */}
        {info.documents.length > 0 ? (
          <div className="bg-white rounded-2xl shadow border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900">On file</h2>
            <p className="text-sm text-stone-500 mt-1">
              These are the documents we currently have for you.
            </p>
            <ul className="mt-4 space-y-2">
              {info.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-stone-200 bg-stone-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900 truncate">{d.name}</p>
                    <p className="text-xs text-stone-500">
                      {DOC_TYPE_OPTIONS.find((o) => o.value === d.doc_type)?.label ?? d.doc_type}
                      {d.expires_at ? ` · expires ${formatDate(d.expires_at)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full ${
                      STATUS_BADGE[d.status] ?? "bg-stone-200 text-stone-700"
                    }`}
                  >
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Upload form */}
        <div className="bg-white rounded-2xl shadow border border-stone-200 p-6">
          <h2 className="text-lg font-semibold text-stone-900">Upload a document</h2>
          <p className="text-sm text-stone-500 mt-1">
            PDF, Word, or image. Maximum 10 MB per file.
          </p>
          <form onSubmit={handleUpload} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Document type
              </label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Display name (optional)
              </label>
              <input
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. Public liability insurance 2026"
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">File</label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept=".pdf,.doc,.docx,image/*"
                className="block w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
              />
            </div>
            {uploadMsg ? (
              <p
                className={`text-sm ${
                  uploadMsg.type === "ok" ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {uploadMsg.text}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={uploading || !file}
              className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? "Uploading..." : "Upload document"}
            </button>
          </form>
        </div>

        {/* Profile form */}
        <div className="bg-white rounded-2xl shadow border border-stone-200 p-6">
          <h2 className="text-lg font-semibold text-stone-900">Your details</h2>
          <p className="text-sm text-stone-500 mt-1">
            Update anything that&apos;s changed. Bank fields are write-only and won&apos;t display
            once saved.
          </p>
          <form onSubmit={handleSaveProfile} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact name" value={contactName} onChange={setContactName} />
              <Field label="Phone" value={phone} onChange={setPhone} />
            </div>
            <Field label="Address" value={address} onChange={setAddress} />
            <Field
              label="Trades (comma-separated)"
              value={tradesInput}
              onChange={setTradesInput}
              placeholder="e.g. plumbing, heating"
            />
            <Field
              label="UK coverage regions (comma-separated)"
              value={regionsInput}
              onChange={setRegionsInput}
              placeholder="e.g. London, South East"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="VAT number" value={vatNumber} onChange={setVatNumber} />
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="vatreg"
                  type="checkbox"
                  checked={vatRegistered}
                  onChange={(e) => setVatRegistered(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-orange-600 focus:ring-orange-500"
                />
                <label htmlFor="vatreg" className="text-sm text-stone-700">
                  VAT registered
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company registration no. (CRN)" value={crn} onChange={setCrn} />
              <Field label="UTR" value={utr} onChange={setUtr} />
            </div>

            <div className="border-t border-stone-200 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-3">
                Bank details (only fill in if changing)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Account holder"
                  value={bankHolder}
                  onChange={setBankHolder}
                  autoComplete="off"
                />
                <Field label="Bank name" value={bankName} onChange={setBankName} autoComplete="off" />
                <Field
                  label="Sort code"
                  value={bankSort}
                  onChange={setBankSort}
                  placeholder="00-00-00"
                  autoComplete="off"
                />
                <Field
                  label="Account number"
                  value={bankAccount}
                  onChange={setBankAccount}
                  autoComplete="off"
                />
              </div>
            </div>

            {profileMsg ? (
              <p
                className={`text-sm ${
                  profileMsg.type === "ok" ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {profileMsg.text}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={savingProfile}
              className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-stone-800 hover:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingProfile ? "Saving..." : "Save my details"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
    </div>
  );
}

export default function PartnerUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-100 flex items-center justify-center">
          <div className="text-stone-500">Loading...</div>
        </div>
      }
    >
      <PartnerUploadContent />
    </Suspense>
  );
}
