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

type RequestedDoc = {
  id: string;
  name: string;
  description: string;
  docType: string;
};

type RequestInfo = {
  id: string;
  requestedDocTypes: string[];
  requestedDocs: RequestedDoc[];
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
  { value: "proof_of_address", label: "Proof of Address" },
  { value: "right_to_work", label: "Right to Work" },
  { value: "utr", label: "UTR (HMRC)" },
  { value: "public_liability", label: "Public Liability Insurance" },
  { value: "photo_id", label: "Photo ID" },
];

/**
 * Picks the most-recent existing doc that matches a requested item — by exact name first
 * (case-insensitive), then by doc_type. Mirrors the admin-side logic so the partner sees
 * the same "Valid / Missing" verdict the dashboard already shows.
 */
function findMatchingDoc(req: RequestedDoc, docs: ExistingDoc[]): ExistingDoc | null {
  const wanted = req.name.trim().toLowerCase();
  const byName = docs
    .filter((d) => (d.name ?? "").trim().toLowerCase() === wanted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (byName[0]) return byName[0];
  const byType = docs
    .filter((d) => d.doc_type === req.docType)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return byType[0] ?? null;
}

function describeDocStatus(doc: ExistingDoc | null): { label: string; tone: "ok" | "warn" | "bad" | "missing" } {
  if (!doc) return { label: "Missing", tone: "missing" };
  if (doc.expires_at) {
    const now = Date.now();
    const exp = new Date(doc.expires_at).getTime();
    if (exp < now) return { label: "Expired", tone: "bad" };
    if (exp - now < 30 * 24 * 60 * 60 * 1000) return { label: "Expiring soon", tone: "warn" };
  }
  return { label: "On file", tone: "ok" };
}

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

  /** Per-card upload state — keyed by required-doc id (or "__free__" for the generic
   *  upload card shown when no specific docs were requested). */
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMsgs, setUploadMsgs] = useState<Record<string, { type: "ok" | "err"; text: string }>>({});

  // Free-form upload (only used when the admin didn't list specific required docs)
  const [freeDocType, setFreeDocType] = useState("other");
  const [freeDocName, setFreeDocName] = useState("");
  const [freeFile, setFreeFile] = useState<File | null>(null);

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
          setFreeDocType(i.request.requestedDocTypes[0]);
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

  /**
   * One uploader to rule them all. `slotId` is the per-card key used to track which card
   * is busy / shows which message; `docType` and `name` are what gets sent to the API.
   * On success, the doc list refreshes so the card flips from "Missing" to "On file".
   */
  const uploadFileForSlot = useCallback(
    async (slotId: string, file: File, docType: string, name: string) => {
      if (!token) return;
      setUploadingId(slotId);
      setUploadMsgs((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      try {
        const fd = new FormData();
        fd.append("token", token);
        fd.append("file", file);
        fd.append("docType", docType);
        fd.append("name", name.trim() || file.name);
        const res = await fetch("/api/partner-upload/file", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setUploadMsgs((prev) => ({
            ...prev,
            [slotId]: { type: "err", text: data.error ?? "Upload failed." },
          }));
          return;
        }
        setUploadMsgs((prev) => ({
          ...prev,
          [slotId]: { type: "ok", text: "Uploaded — thank you!" },
        }));
        loadInfo();
      } catch {
        setUploadMsgs((prev) => ({
          ...prev,
          [slotId]: { type: "err", text: "Network error. Please try again." },
        }));
      } finally {
        setUploadingId(null);
      }
    },
    [token, loadInfo],
  );

  const handleFreeUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!freeFile) return;
    await uploadFileForSlot("__free__", freeFile, freeDocType, freeDocName);
    setFreeFile(null);
    setFreeDocName("");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-500">
          <Spinner className="h-5 w-5" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
          <h1 className="text-xl font-bold text-stone-900">Link unavailable</h1>
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
  const requestedDocs = info.request.requestedDocs ?? [];

  const totalRequested = requestedDocs.length;
  const completedCount = requestedDocs.filter((req) => {
    if (uploadMsgs[req.id]?.type === "ok") return true;
    const m = findMatchingDoc(req, info.documents);
    if (!m) return false;
    if (m.expires_at && new Date(m.expires_at).getTime() < Date.now()) return false;
    return true;
  }).length;
  const allDone = totalRequested > 0 && completedCount === totalRequested;

  return (
    <div className="min-h-screen bg-stone-50 py-6 sm:py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 px-5 sm:px-7 py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-600">
            Master Group
          </p>
          <h1 className="text-2xl sm:text-[26px] font-bold text-stone-900 mt-1.5 leading-tight">
            Hi {partnerName} 👋
          </h1>
          <p className="text-stone-600 mt-2 text-[15px] leading-relaxed">
            {totalRequested > 0
              ? "Please upload the documents below so we can keep your account active."
              : "Use this page to upload any updated documents and confirm your details."}
          </p>
          {info.request.customMessage ? (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">
              {info.request.customMessage}
            </div>
          ) : null}
          {totalRequested > 0 ? (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-stone-600">
                <span>{completedCount} of {totalRequested} uploaded</span>
                {allDone ? (
                  <span className="text-emerald-700 font-semibold">All done — thank you!</span>
                ) : null}
              </div>
              <div className="mt-1.5 h-2 w-full rounded-full bg-stone-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-emerald-500" : "bg-orange-500"}`}
                  style={{ width: `${totalRequested === 0 ? 0 : (completedCount / totalRequested) * 100}%` }}
                />
              </div>
            </div>
          ) : null}
          <p className="text-[11px] text-stone-500 mt-4">
            Link expires on <strong className="text-stone-700">{formatDate(info.request.expiresAt)}</strong>.
          </p>
        </div>

        {/* Per-document upload cards — one card per item the admin asked for. */}
        {requestedDocs.length > 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 px-5 sm:px-7 py-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold text-stone-900">What we need from you</h2>
              <span className="text-xs text-stone-500">PDF, Word or image · max 10 MB</span>
            </div>
            <ul className="mt-4 space-y-3">
              {requestedDocs.map((req) => {
                const existing = findMatchingDoc(req, info.documents);
                const status = describeDocStatus(existing);
                const slotMsg = uploadMsgs[req.id];
                const isBusy = uploadingId === req.id;
                return (
                  <RequestedDocCard
                    key={req.id}
                    req={req}
                    existing={existing}
                    statusLabel={status.label}
                    statusTone={status.tone}
                    busy={isBusy}
                    message={slotMsg ?? null}
                    onPick={(f) => {
                      void uploadFileForSlot(req.id, f, req.docType, req.name);
                    }}
                  />
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Free-form upload — only when admin didn't request any specific doc. */}
        {requestedDocs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900">Upload a document</h2>
            <p className="text-sm text-stone-500 mt-1">
              PDF, Word or image. Maximum 10 MB per file.
            </p>
            <form onSubmit={handleFreeUpload} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">
                  Document type
                </label>
                <select
                  value={freeDocType}
                  onChange={(e) => setFreeDocType(e.target.value)}
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
                  value={freeDocName}
                  onChange={(e) => setFreeDocName(e.target.value)}
                  placeholder="e.g. Public liability insurance 2026"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">File</label>
                <input
                  type="file"
                  onChange={(e) => setFreeFile(e.target.files?.[0] ?? null)}
                  accept=".pdf,.doc,.docx,image/*"
                  className="block w-full text-sm text-stone-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                />
              </div>
              {uploadMsgs.__free__ ? (
                <p
                  className={`text-sm ${
                    uploadMsgs.__free__.type === "ok" ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {uploadMsgs.__free__.text}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={uploadingId === "__free__" || !freeFile}
                className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploadingId === "__free__" ? "Uploading..." : "Upload document"}
              </button>
            </form>
          </div>
        ) : null}

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

type StatusTone = "ok" | "warn" | "bad" | "missing";

/**
 * Inline SVG icons — keeps the bundle small (no icon-pack dep on a public page that
 * has to load fast on slow mobile connections).
 */
function StatusGlyph({ tone, className = "h-5 w-5" }: { tone: StatusTone; className?: string }) {
  if (tone === "ok") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
    );
  }
  if (tone === "bad") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6M9 9l6 6" />
      </svg>
    );
  }
  /** missing */
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One required-doc card. Each card is a single big tap target — the entire surface is the
 * file picker. Picking a file uploads immediately (no submit step) because every extra
 * click is a drop-off risk on a self-service mobile flow. Visual states are mutually
 * exclusive and color-coded so the partner can scan the list and instantly see what's
 * left to do.
 */
function RequestedDocCard({
  req,
  existing,
  statusLabel,
  statusTone,
  busy,
  message,
  onPick,
}: {
  req: RequestedDoc;
  existing: ExistingDoc | null;
  statusLabel: string;
  statusTone: StatusTone;
  busy: boolean;
  message: { type: "ok" | "err"; text: string } | null;
  onPick: (file: File) => void;
}) {
  const inputId = `partner-doc-file-${req.id}`;

  /** Effective tone — once a file has just been uploaded successfully we override the
   *  card to "ok" even if the doc list hasn't refreshed yet, so the user sees instant feedback. */
  const justUploaded = message?.type === "ok";
  const effectiveTone: StatusTone = justUploaded ? "ok" : statusTone;

  const toneStyles: Record<StatusTone, { card: string; icon: string; chip: string }> = {
    ok: {
      card: "border-emerald-300 bg-emerald-50/60 hover:border-emerald-400 hover:bg-emerald-50",
      icon: "bg-emerald-500 text-white",
      chip: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    },
    warn: {
      card: "border-amber-300 bg-amber-50/60 hover:border-amber-400 hover:bg-amber-50",
      icon: "bg-amber-500 text-white",
      chip: "bg-amber-100 text-amber-900 ring-1 ring-amber-200",
    },
    bad: {
      card: "border-red-300 bg-red-50/60 hover:border-red-400 hover:bg-red-50",
      icon: "bg-red-500 text-white",
      chip: "bg-red-100 text-red-800 ring-1 ring-red-200",
    },
    missing: {
      card: "border-stone-300 border-dashed bg-white hover:border-orange-400 hover:bg-orange-50/40",
      icon: "bg-stone-100 text-stone-500",
      chip: "bg-stone-100 text-stone-700 ring-1 ring-stone-200",
    },
  };
  const tone = toneStyles[effectiveTone];

  const ctaLabel = existing || justUploaded ? "Replace file" : "Choose file";

  return (
    <li>
      <label
        htmlFor={inputId}
        className={`group relative block cursor-pointer rounded-2xl border-2 p-4 sm:p-5 transition-all duration-150 ${tone.card} ${busy ? "pointer-events-none opacity-90" : ""}`}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <div className={`flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
            {busy ? <Spinner /> : <StatusGlyph tone={effectiveTone} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-base font-semibold text-stone-900 leading-tight">{req.name}</p>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${tone.chip}`}>
                {busy ? "Uploading" : justUploaded ? "Uploaded" : statusLabel}
              </span>
            </div>
            {req.description ? (
              <p className="text-sm text-stone-600 mt-0.5">{req.description}</p>
            ) : null}
            {existing && !justUploaded ? (
              <p className="text-xs text-stone-500 mt-1.5 truncate">
                <span className="font-medium text-stone-600">On file:</span>{" "}
                {existing.name}
                {existing.expires_at ? ` · expires ${formatDate(existing.expires_at)}` : ""}
              </p>
            ) : null}
            {message?.type === "err" ? (
              <p className="text-xs font-medium text-red-700 mt-1.5">
                {message.text} — please try again.
              </p>
            ) : null}
          </div>
          <div
            className={`hidden sm:inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm transition-colors ${
              busy
                ? "bg-stone-300 text-stone-600"
                : "bg-orange-600 text-white group-hover:bg-orange-700"
            }`}
            aria-hidden="true"
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4" />
                Uploading
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                {ctaLabel}
              </>
            )}
          </div>
        </div>
        <div
          className={`sm:hidden mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
            busy
              ? "bg-stone-300 text-stone-600"
              : "bg-orange-600 text-white group-hover:bg-orange-700"
          }`}
          aria-hidden="true"
        >
          {busy ? (
            <>
              <Spinner className="h-4 w-4" />
              Uploading...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              {ctaLabel}
            </>
          )}
        </div>
        <input
          id={inputId}
          type="file"
          accept=".pdf,.doc,.docx,image/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            /** Reset so picking the same filename twice still triggers onChange. */
            e.currentTarget.value = "";
          }}
          className="sr-only"
        />
      </label>
    </li>
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
