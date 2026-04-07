"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
  ExternalLink,
  User,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";

type SessionChecklistItem = {
  id: string;
  name: string;
  description: string;
  docType: string;
  status: "valid" | "expired" | "missing";
  matchedIds: string[];
};

type SessionDocument = {
  id: string;
  name: string;
  docType: string;
  docTypeLabel: string;
  status: string;
  fileName: string | null;
  createdAt: string;
  expiresAt: string | null;
  viewUrl: string | null;
  canDelete: boolean;
};

type SessionPayload = {
  expiresAt: string;
  branding: { companyName: string; logoUrl: string | null; logoLightUrl: string | null };
  partner: {
    id: string;
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    trade: string;
    trades: string[] | null;
    partnerAddress: string;
    partnerLegalType: string | null;
    effectiveLegalType: "self_employed" | "limited_company";
    crn: string;
    utr: string;
    vatRegistered: boolean | null;
    vatNumber: string;
    status: string;
    hasBankOnFile: boolean;
  };
  checklist: SessionChecklistItem[];
  documents: SessionDocument[];
};

function statusBadgeDark(status: string) {
  const s = status.toLowerCase();
  if (s === "approved") return "border border-emerald-800 bg-emerald-950/50 text-emerald-400";
  if (s === "pending") return "border border-amber-800 bg-amber-950/40 text-amber-300";
  if (s === "rejected") return "border border-red-900 bg-red-950/40 text-red-300";
  if (s === "expired") return "border border-zinc-700 bg-zinc-800 text-zinc-400";
  return "border border-zinc-700 bg-zinc-800 text-zinc-400";
}

function checklistRowStatusDark(st: "valid" | "expired" | "missing") {
  if (st === "valid") {
    return { label: "Received", className: "bg-emerald-950/50 text-emerald-400 border border-emerald-800" };
  }
  if (st === "expired") {
    return { label: "Expired", className: "bg-orange-950/40 text-orange-300 border border-orange-900/60" };
  }
  return { label: "Missing", className: "bg-zinc-800 text-zinc-400 border border-zinc-700" };
}

function allowsMultipleUploads(item: SessionChecklistItem): boolean {
  return item.docType === "certification" || item.id === "dbs" || item.id === "other";
}

function DocumentRequirementCard({
  item,
  matchedDocuments,
  portalCode,
  portalToken,
  onSuccess,
  onDeleteDocument,
  uploadingId,
  setUploadingId,
}: {
  item: SessionChecklistItem;
  matchedDocuments: SessionDocument[];
  portalCode: string;
  portalToken: string;
  onSuccess: () => void | Promise<void>;
  onDeleteDocument: (id: string) => void | Promise<void>;
  uploadingId: string | null;
  setUploadingId: (id: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const [otherLabel, setOtherLabel] = useState("");
  const busy = uploadingId === item.id;
  const st = checklistRowStatusDark(item.status);

  const primaryDoc = useMemo(() => {
    if (matchedDocuments.length === 0) return null;
    return [...matchedDocuments].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
  }, [matchedDocuments]);

  const showAddAnother = allowsMultipleUploads(item) && matchedDocuments.length > 0;
  const showFirstUpload = matchedDocuments.length === 0;

  const runUpload = async (file: File, replaceDocumentId?: string) => {
    let displayName: string | undefined;
    if (item.id === "other") {
      const t = otherLabel.trim();
      if (!t) {
        toast.error("Add a short label above before choosing a file.");
        return;
      }
      displayName = t;
    }
    setUploadingId(item.id);
    try {
      const fd = new FormData();
      if (portalCode) fd.set("code", portalCode);
      else fd.set("token", portalToken);
      fd.set("requirementId", item.id);
      if (displayName) fd.set("displayName", displayName);
      if (replaceDocumentId) fd.set("replaceDocumentId", replaceDocumentId);
      fd.set("file", file);
      const res = await fetch("/api/partner-upload/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; replaced?: boolean };
      if (!res.ok) {
        toast.error(j.error ?? "Upload failed.");
        return;
      }
      toast.success(
        replaceDocumentId
          ? "File replaced — pending review again."
          : "Uploaded — it will show as pending review.",
      );
      await onSuccess();
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-[#121212] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] min-h-[176px]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white leading-snug">{item.name}</h3>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.className}`}
        >
          {item.status === "valid" && <CheckCircle2 className="h-3 w-3" />}
          {item.status === "expired" && <Clock className="h-3 w-3" />}
          {item.status === "missing" && <AlertCircle className="h-3 w-3" />}
          {st.label}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-400 leading-relaxed flex-1">{item.description}</p>

      {primaryDoc && (
        <p className="mt-2 text-xs text-zinc-500 truncate" title={primaryDoc.fileName ?? undefined}>
          Latest file: {primaryDoc.fileName ?? "Uploaded"}
        </p>
      )}

      {item.id === "other" && (
        <label className="mt-3 block">
          <span className="sr-only">Document label</span>
          <input
            type="text"
            value={otherLabel}
            onChange={(e) => setOtherLabel(e.target.value)}
            placeholder="e.g. Gas Safe certificate"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#e93701]/35"
          />
        </label>
      )}

      <div className="mt-auto pt-4 flex flex-col gap-2">
        {primaryDoc && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                replaceTargetRef.current = primaryDoc.id;
                inputRef.current?.click();
              }}
              className="inline-flex flex-1 min-w-[8rem] items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900/80 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 opacity-90" />}
              Replace file
            </button>
            {primaryDoc.canDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDeleteDocument(primaryDoc.id)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-900/55 bg-red-950/35 py-2.5 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-950/55 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
          </div>
        )}

        {(showFirstUpload || showAddAnother) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              replaceTargetRef.current = null;
              inputRef.current?.click();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800/80 hover:border-zinc-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 opacity-80" />}
            {busy ? "Uploading…" : showAddAnother ? "Add another file" : "Add document"}
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.doc,.docx,image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            const rep = replaceTargetRef.current;
            replaceTargetRef.current = null;
            e.target.value = "";
            if (f) void runUpload(f, rep ?? undefined);
          }}
        />
      </div>
    </div>
  );
}

export function PartnerUploadClient() {
  const searchParams = useSearchParams();
  const portalCode = searchParams.get("code")?.trim() ?? "";
  const portalToken = searchParams.get("token")?.trim() ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);

  const [uploadingRequirementId, setUploadingRequirementId] = useState<string | null>(null);

  const [profileSaving, setProfileSaving] = useState(false);
  const [contactName, setContactName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [partnerAddress, setPartnerAddress] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [crn, setCrn] = useState("");
  const [utr, setUtr] = useState("");
  const [vatRegistered, setVatRegistered] = useState<boolean | null>(null);
  const [bankSortCode, setBankSortCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");

  const loadSession = useCallback(async () => {
    if (!portalCode && !portalToken) {
      setError("This link is incomplete. Open the link you were sent (email or WhatsApp).");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = portalCode
        ? `code=${encodeURIComponent(portalCode)}`
        : `token=${encodeURIComponent(portalToken)}`;
      const res = await fetch(`/api/partner-upload/session?${q}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setError("This link has expired or is invalid. Ask the office for a new upload link.");
        setSession(null);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        const code = j.error;
        const detail = j.message?.trim();
        if (res.status === 500 && code === "partner_lookup_failed" && detail) {
          setError(`Could not load partner data. ${detail}`);
        } else if (code === "partner_not_found") {
          setError(
            "This upload link is no longer valid for this partner. Ask the office for a new document link.",
          );
        } else {
          setError(detail || code || "Could not load this page.");
        }
        setSession(null);
        return;
      }
      const data = (await res.json()) as SessionPayload;
      setSession(data);
      setContactName(data.partner.contactName);
      setCompanyName(data.partner.companyName);
      setPhone(data.partner.phone);
      setPartnerAddress(data.partner.partnerAddress);
      setVatNumber(data.partner.vatNumber);
      setCrn(data.partner.crn);
      setUtr(data.partner.utr);
      setVatRegistered(data.partner.vatRegistered);
    } catch {
      setError("Network error. Check your connection and try again.");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [portalCode, portalToken]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const deleteDocument = async (id: string) => {
    if (!portalCode && !portalToken) return;
    if (!confirm("Remove this file? You can upload a replacement afterwards.")) return;
    try {
      const q = portalCode
        ? `code=${encodeURIComponent(portalCode)}&id=${encodeURIComponent(id)}`
        : `token=${encodeURIComponent(portalToken)}&id=${encodeURIComponent(id)}`;
      const res = await fetch(`/api/partner-upload/document?${q}`, {
        method: "DELETE",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(j.error ?? "Could not delete.");
        return;
      }
      toast.success("Document removed.");
      await loadSession();
    } catch {
      toast.error("Network error.");
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portalCode && !portalToken) return;
    setProfileSaving(true);
    try {
      const body: Record<string, unknown> = {
        ...(portalCode ? { code: portalCode } : { token: portalToken }),
        contactName,
        companyName,
        phone,
        partnerAddress,
        vatNumber,
        crn,
        utr,
      };
      if (vatRegistered !== null) body.vatRegistered = vatRegistered;
      const anyBank =
        bankSortCode.trim() ||
        bankAccountNumber.trim() ||
        bankAccountHolder.trim() ||
        bankName.trim();
      if (anyBank) {
        body.bankSortCode = bankSortCode;
        body.bankAccountNumber = bankAccountNumber;
        body.bankAccountHolder = bankAccountHolder;
        body.bankName = bankName;
      }
      const res = await fetch("/api/partner-upload/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(j.error ?? "Could not save details.");
        return;
      }
      toast.success("Your details were saved.");
      setBankSortCode("");
      setBankAccountNumber("");
      setBankAccountHolder("");
      setBankName("");
      await loadSession();
    } finally {
      setProfileSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
        <Loader2 className="h-8 w-8 animate-spin text-[#e93701]" aria-hidden />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6">
        <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-[#121212] p-8 shadow-xl shadow-black/40">
          <div className="flex items-start gap-3 text-zinc-100">
            <AlertCircle className="h-6 w-6 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-lg">Cannot open upload page</p>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const brand = session.branding.companyName || "Master";
  /** Prefer default logo on dark background; fall back to light-theme asset. */
  const logo = session.branding.logoUrl || session.branding.logoLightUrl;

  const inputDark =
    "w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#e93701]/35";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-16 antialiased">
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:pt-12 space-y-8">
        <header className="rounded-2xl border border-zinc-800 bg-[#121212] p-6 sm:p-8 shadow-lg shadow-black/30">
          <div className="flex items-center gap-3 mb-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-10 w-auto max-w-[160px] object-contain" />
            ) : (
              <span className="text-xs font-bold tracking-widest text-[#e93701] uppercase">{brand}</span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Hi {session.partner.contactName?.split(" ")[0] || "there"} 👋
          </h1>
          <p className="mt-3 text-zinc-400 leading-relaxed text-[15px]">
            Upload what we asked for — one file per card. PDF, Word, or image, up to{" "}
            <strong className="text-zinc-200 font-semibold">10 MB</strong> each.
          </p>
          <p className="mt-4 text-sm text-zinc-500">
            Link expires on{" "}
            <time dateTime={session.expiresAt} className="font-medium text-zinc-300">
              {format(new Date(session.expiresAt), "MMM d, yyyy")}
            </time>
            .
          </p>
        </header>

        <section>
          <h2 className="text-base font-semibold text-white mb-1">Documents requested</h2>
          <p className="text-sm text-zinc-500 mb-5 max-w-2xl">
            Use <span className="text-zinc-400">Replace file</span> or <span className="text-zinc-400">Remove</span> to change
            what you sent. <span className="text-zinc-400">Add document</span> (or Add another file for certificates) uploads a
            new file.
          </p>
          {session.checklist.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 rounded-xl border border-dashed border-zinc-800 px-4 text-center bg-zinc-900/40">
              No document requests are configured for this link.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {session.checklist.map((c) => {
                const matchedDocuments = session.documents.filter((d) => c.matchedIds.includes(d.id));
                return (
                  <DocumentRequirementCard
                    key={c.id}
                    item={c}
                    matchedDocuments={matchedDocuments}
                    portalCode={portalCode}
                    portalToken={portalToken}
                    onSuccess={loadSession}
                    onDeleteDocument={deleteDocument}
                    uploadingId={uploadingRequirementId}
                    setUploadingId={setUploadingRequirementId}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-[#121212] p-6 sm:p-8 shadow-lg shadow-black/30">
          <h2 className="text-lg font-semibold text-white mb-1">Your uploads</h2>
          <p className="text-sm text-zinc-500 mb-5">
            Replace or remove files from the cards above. Pending uploads are reviewed by the team; replacing an approved file
            sends it back to pending review.
          </p>
          {session.documents.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center border border-dashed border-zinc-800 rounded-xl">No uploads yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-900/80 text-left text-zinc-500 border-b border-zinc-800">
                    <th className="px-3 py-2.5 font-medium">Document</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium w-[1%]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {session.documents.map((d) => (
                    <tr key={d.id} className="border-t border-zinc-800/80 bg-zinc-950/30">
                      <td className="px-3 py-3 text-zinc-100">
                        <div className="font-medium">{d.name}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {d.fileName ?? "File"} · {format(new Date(d.createdAt), "d MMM yyyy")}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-zinc-400">{d.docTypeLabel}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeDark(d.status)}`}
                        >
                          {d.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {d.viewUrl && (
                            <a
                              href={d.viewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View
                            </a>
                          )}
                          {d.canDelete && (
                            <button
                              type="button"
                              onClick={() => void deleteDocument(d.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-950/70"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-[#121212] p-6 sm:p-8 shadow-lg shadow-black/30">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-5 w-5 text-[#e93701]" />
            <h2 className="text-lg font-semibold text-white">Your details</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-6">
            Update anything that has changed. Bank details are optional — we never show saved numbers on this page.
            {session.partner.hasBankOnFile && (
              <span className="block mt-2 font-medium text-zinc-300">We already have bank details on file.</span>
            )}
          </p>

          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Company / trading name</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputDark} />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Contact name</label>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputDark} />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputDark} />
              </div>
              <div className="sm:col-span-2">
                <AddressAutocomplete
                  variant="dark"
                  multiline
                  label="Address"
                  value={partnerAddress}
                  onChange={setPartnerAddress}
                  onSelect={(parts) => setPartnerAddress(parts.full_address)}
                  country="gb"
                  placeholder="Start typing to search for an address or postcode…"
                />
              </div>
            </div>

            {session.partner.effectiveLegalType === "limited_company" && (
              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Company number (CRN)</label>
                  <input value={crn} onChange={(e) => setCrn(e.target.value)} className={inputDark} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">VAT registered?</label>
                  <select
                    value={vatRegistered === null ? "" : vatRegistered ? "yes" : "no"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVatRegistered(v === "" ? null : v === "yes");
                    }}
                    className={inputDark}
                  >
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">VAT number</label>
                  <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className={inputDark} />
                </div>
              </div>
            )}

            {session.partner.effectiveLegalType !== "limited_company" && (
              <div className="pt-2 border-t border-zinc-800">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">UTR (self-employed)</label>
                <input value={utr} onChange={(e) => setUtr(e.target.value)} className={inputDark} />
              </div>
            )}

            <div className="pt-2 border-t border-zinc-800 space-y-3">
              <p className="text-sm font-medium text-zinc-300">UK bank details (optional)</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Sort code</label>
                  <input
                    value={bankSortCode}
                    onChange={(e) => setBankSortCode(e.target.value)}
                    placeholder="12-34-56"
                    autoComplete="off"
                    className={inputDark}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Account number</label>
                  <input
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    autoComplete="off"
                    className={inputDark}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Account holder</label>
                  <input value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} className={inputDark} />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Bank name</label>
                  <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputDark} />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={profileSaving}
              className="w-full sm:w-auto rounded-xl bg-[#e93701] py-2.5 px-8 text-sm font-semibold text-white hover:bg-[#cf3101] disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[#e93701]/10"
            >
              {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save details
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
