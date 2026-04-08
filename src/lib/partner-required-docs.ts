import type { Partner } from "@/types/database";
import { inferPartnerLegal } from "@/lib/partner-compliance";

/** Minimal shape for compliance matching (partner_documents rows + synthetic queue items). */
export interface PartnerDocLike {
  id: string;
  name: string;
  doc_type: string;
  status?: string;
  uploaded_by?: string;
  file_name?: string;
  file_path?: string | null;
  preview_image_path?: string | null;
  expires_at?: string;
  notes?: string;
  created_at: string;
  /** When false, excluded from compliance score (reference / archive copy). Default true for legacy rows. */
  counts_toward_compliance?: boolean | null;
}

const DOC_TYPES_NO_EXPIRY = new Set([
  "utr",
  "service_agreement",
  "self_bill_agreement",
  "proof_of_address",
  "right_to_work",
  /** Optional UK basic DBS — issue date only; no fixed expiry in product */
  "dbs",
]);

const DOC_TYPES_EXPIRY_ONE_YEAR_FROM_UPLOAD = new Set(["poa"]);

export type PartnerDocExpiryPolicy = "none" | "one_year_from_upload" | "manual";

export function partnerDocExpiryPolicy(docType: string): PartnerDocExpiryPolicy {
  if (DOC_TYPES_NO_EXPIRY.has(docType)) return "none";
  if (DOC_TYPES_EXPIRY_ONE_YEAR_FROM_UPLOAD.has(docType)) return "one_year_from_upload";
  return "manual";
}

/** Resolves DB `expires_at` from doc type + optional date from the form (at upload time). */
export function resolvePartnerDocExpiresAt(docType: string, expiresAt?: string): string | null {
  if (DOC_TYPES_NO_EXPIRY.has(docType)) return null;
  if (DOC_TYPES_EXPIRY_ONE_YEAR_FROM_UPLOAD.has(docType)) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }
  if (expiresAt?.trim()) return new Date(expiresAt.trim()).toISOString();
  return null;
}

export const REQUIRED_PARTNER_DOCS = [
  {
    id: "photo_id",
    name: "Photo ID",
    description: "Passport or driving license",
    docType: "id_proof",
    aliases: ["photo id", "passport", "driver license", "driving license", "id proof"],
  },
  {
    id: "proof_of_address",
    name: "Proof of Address",
    description: "Utility bill or bank statement",
    docType: "proof_of_address",
    aliases: ["proof of address", "utility bill", "bank statement", "address proof"],
  },
  {
    id: "right_to_work",
    name: "Right to Work",
    description: "Share code, birth certificate, or passport",
    docType: "right_to_work",
    aliases: ["right to work", "share code", "birth certificate", "british passport", "passport"],
  },
  {
    id: "public_liability",
    name: "Public Liability Insurance",
    description: "Active public liability policy",
    docType: "insurance",
    aliases: ["public liability", "insurance", "liability insurance"],
  },
] as const;

export const CERT_REQUIREMENTS_BY_TRADE: Record<string, string[]> = {
  /** WRAS omitted for now (not required for small repairs). */
  Plumber: ["Water Regulations"],
  Electrician: ["NICEIC", "ECS Card", "18th Edition Wiring Regulations"],
  "Gas Safety Certificate": ["Gas Safe Certificate", "ACS Gas Certificate"],
  "PAT Testing": ["PAT Testing Certificate"],
  "PAT EICR": ["PAT Testing Certificate", "EICR Qualification"],
  EICR: ["EICR Qualification"],
  "Fire Alarm Certificate": ["Fire Alarm Certification"],
  "Emergency Lighting Certificate": ["Emergency Lighting Certification"],
  "Fire Extinguisher Service": ["BAFE / extinguisher servicing certificate"],
};

/** Not counted in compliance score — shown as optional upload prompts per trade. */
export const OPTIONAL_TRADE_CERTS_BY_TRADE: Record<string, string[]> = {
  Builder: ["CSCS Card"],
  Carpenter: ["CSCS Card"],
};

export type RequiredDocDef = {
  id: string;
  name: string;
  description: string;
  docType: string;
  aliases: readonly string[];
};

/** Self-employed only — same card UX as other required docs (doc_type `utr`). */
export const UTR_REQUIRED_DOC: RequiredDocDef = {
  id: "utr_hmrc",
  name: "UTR (HMRC)",
  description: "Proof of Unique Taxpayer Reference (HMRC letter or screenshot)",
  docType: "utr",
  aliases: ["utr", "hmrc", "unique taxpayer", "utr (hmrc)", "tax reference"],
};

/** Always included in blended document score (with core mandatory IDs). */
export const AGREEMENT_REQUIRED_DOCS: RequiredDocDef[] = [
  {
    id: "service_agreement",
    name: "Service Agreement",
    description: "Signed service agreement on file",
    docType: "service_agreement",
    aliases: ["service agreement", "service_agreement"],
  },
  {
    id: "self_bill_agreement",
    name: "Self Bill Agreement",
    description: "Signed self-bill agreement on file",
    docType: "self_bill_agreement",
    aliases: ["self bill", "self-bill", "self_bill_agreement", "self bill agreement"],
  },
];

/**
 * Full mandatory checklist for the partner (Documents UI): core IDs, UTR when self-employed, agreements.
 * Trade certificates are separate ({@link buildTradeCertificateRequirements}).
 */
export function buildMandatoryDocsChecklist(partner: Partner | null): RequiredDocDef[] {
  const core: RequiredDocDef[] = [...REQUIRED_PARTNER_DOCS];
  const withUtr =
    partner && inferPartnerLegal(partner) === "self_employed" ? [...core, UTR_REQUIRED_DOC] : [...core];
  return [...withUtr, ...AGREEMENT_REQUIRED_DOCS];
}

/**
 * All requirement definitions that can be toggled in Settings (core + UTR + agreements).
 * Trade certs are configured per partner trade, not here.
 */
export function getAllConfigurableComplianceRequirementDefs(): RequiredDocDef[] {
  return [...REQUIRED_PARTNER_DOCS, UTR_REQUIRED_DOC, ...AGREEMENT_REQUIRED_DOCS];
}

/**
 * Subset of {@link buildMandatoryDocsChecklist} that counts toward the numeric document score.
 * @param companyExcludedDocIds — from `company_settings.compliance_score_excluded_doc_ids` (Settings → admin).
 */
export function buildMandatoryDocsForComplianceScore(
  partner: Partner | null,
  companyExcludedDocIds?: string[] | null,
): RequiredDocDef[] {
  const full = buildMandatoryDocsChecklist(partner);
  const excluded = new Set(companyExcludedDocIds ?? []);
  return full.filter((r) => !excluded.has(r.id));
}

export function pickRequiredDocMatch(docs: PartnerDocLike[], req: RequiredDocDef): PartnerDocLike | null {
  return pickRequiredDocMatches(docs, req)[0] ?? null;
}

export function pickRequiredDocMatches(docs: PartnerDocLike[], req: RequiredDocDef): PartnerDocLike[] {
  const eligible = docs.filter((d) => d.counts_toward_compliance !== false);
  const aliasMatch = eligible.filter((d) => {
    const n = String(d.name ?? "").toLowerCase();
    return req.aliases.some((a) => n.includes(a));
  });
  const byType = eligible.filter((d) => d.doc_type === req.docType);
  const byId = new Map<string, PartnerDocLike>();
  for (const doc of [...aliasMatch, ...byType]) byId.set(doc.id, doc);
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function extractCertificateNumber(doc: Pick<PartnerDocLike, "notes">): string | null {
  const t = String(doc.notes ?? "").trim();
  if (!t) return null;
  const m = t.match(/^certificate_number:\s*(.+)$/i);
  if (m?.[1]) return m[1].trim();
  return null;
}

export function buildTradeCertificateRequirements(trades: string[] | null | undefined): RequiredDocDef[] {
  const out: RequiredDocDef[] = [];
  const seen = new Set<string>();
  for (const t of trades ?? []) {
    const certs = CERT_REQUIREMENTS_BY_TRADE[t] ?? [];
    for (const cert of certs) {
      const key = cert.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `trade-cert-${key.replace(/[^a-z0-9]+/g, "-")}`,
        name: cert,
        description: `Required for ${t} work`,
        docType: "certification",
        aliases: [key, "certificate", t.toLowerCase()],
      });
    }
  }
  return out;
}

export function buildRequiredDocumentChecklist(
  trades: string[] | null | undefined,
  partner: Partner | null,
): RequiredDocDef[] {
  const tradeCerts = buildTradeCertificateRequirements(trades);
  const core: RequiredDocDef[] = [...REQUIRED_PARTNER_DOCS];
  if (partner && inferPartnerLegal(partner) === "self_employed") {
    return [...core, UTR_REQUIRED_DOC, ...tradeCerts];
  }
  return [...core, ...tradeCerts];
}

export function computeComplianceScore(docs: PartnerDocLike[], requiredDocs: RequiredDocDef[]): number {
  if (requiredDocs.length === 0) return 100;
  const now = new Date();
  let validCount = 0;
  for (const req of requiredDocs) {
    const matches = pickRequiredDocMatches(docs, req);
    const hasValidDoc = matches.some((d) => !d.expires_at || new Date(d.expires_at) >= now);
    if (hasValidDoc) validCount += 1;
  }
  return Math.round((validCount / requiredDocs.length) * 100);
}

/** Same rules as `computeComplianceScore` — one row per required checklist item. */
export function getRequiredDocComplianceStatus(
  docs: PartnerDocLike[],
  req: RequiredDocDef,
): "valid" | "expired" | "missing" {
  const matches = pickRequiredDocMatches(docs, req);
  const now = new Date();
  const hasValid = matches.some((d) => !d.expires_at || new Date(d.expires_at) >= now);
  if (hasValid) return "valid";
  if (matches.length > 0) return "expired";
  return "missing";
}

export function getOptionalDbsStatus(docs: PartnerDocLike[]): "valid" | "expired" | "missing" {
  const dbsDocs = docs.filter((d) => d.doc_type === "dbs");
  if (dbsDocs.length === 0) return "missing";
  const now = new Date();
  const hasValid = dbsDocs.some((d) => !d.expires_at || new Date(d.expires_at) >= now);
  if (hasValid) return "valid";
  return "expired";
}

/** Human label for doc_type (no icon). */
export function getDocTypeShortLabel(docType: string): string {
  const map: Record<string, string> = {
    insurance: "Insurance",
    certification: "Certification",
    license: "License",
    contract: "Contract",
    tax: "Tax",
    utr: "UTR / HMRC",
    service_agreement: "Service agreement",
    self_bill_agreement: "Self-bill agreement",
    id_proof: "ID proof",
    proof_of_address: "Proof of address",
    right_to_work: "Right to work",
    poa: "Power of attorney",
    dbs: "DBS",
    other: "Other",
  };
  return map[docType] ?? docType;
}
