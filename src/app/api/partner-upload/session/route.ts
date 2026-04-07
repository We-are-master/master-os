import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerPortalCredential } from "@/lib/partner-portal-session";
import {
  buildRequiredDocumentChecklist,
  getDocTypeShortLabel,
  getRequiredDocComplianceStatus,
  getOptionalDbsStatus,
  pickRequiredDocMatches,
  type PartnerDocLike,
} from "@/lib/partner-required-docs";
import { getPartnerDocumentSignedUrlWithSupabase } from "@/services/partner-documents-storage";
import type { Partner } from "@/types/database";
import { inferPartnerLegal } from "@/lib/partner-compliance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim();
  const token = req.nextUrl.searchParams.get("token")?.trim();
  const credential = code || token;
  if (!credential) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const session = await resolvePartnerPortalCredential(credential);
  if (!session) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    // Use * so older DBs missing newer columns still return a row (explicit select can 400).
    const { data: partner, error: pErr } = await supabase
      .from("partners")
      .select("*")
      .eq("id", session.partnerId)
      .maybeSingle();

    if (pErr) {
      console.error("[partner-upload/session] partner select error:", pErr.message);
      return NextResponse.json(
        { error: "partner_lookup_failed", message: pErr.message },
        { status: 500 },
      );
    }
    if (!partner) {
      return NextResponse.json({ error: "partner_not_found" }, { status: 404 });
    }

    const { data: docs, error: dErr } = await supabase
      .from("partner_documents")
      .select("id, name, doc_type, status, file_name, file_path, expires_at, notes, created_at")
      .eq("partner_id", session.partnerId)
      .order("created_at", { ascending: false });

    if (dErr) {
      return NextResponse.json({ error: dErr.message }, { status: 500 });
    }

    const docRows = (docs ?? []) as PartnerDocLike[];
    const trades = ((partner as Partner).trades?.length ? (partner as Partner).trades : null) ?? [
      (partner as Partner).trade,
    ];
    const partnerRow = partner as Partner;
    const fullChecklist = buildRequiredDocumentChecklist(trades, partnerRow);
    const requested = session.requestedDocIds;

    const checklistCore = fullChecklist.filter((req) => {
      if (requested == null) return true;
      return requested.includes(req.id);
    });

    const checklistWithStatus = checklistCore.map((req) => ({
      id: req.id,
      name: req.name,
      description: req.description,
      docType: req.docType,
      status: getRequiredDocComplianceStatus(docRows, req),
      matchedIds: pickRequiredDocMatches(docRows, req).map((d) => d.id),
    }));

    const showDbs = requested == null || requested.includes("dbs");
    const showOther = requested == null || requested.includes("other");

    const optionalDbsStatus = getOptionalDbsStatus(docRows);

    const checklistExtras: {
      id: string;
      name: string;
      description: string;
      docType: string;
      status: "valid" | "expired" | "missing";
      matchedIds: string[];
    }[] = [];

    if (showDbs) {
      const st = optionalDbsStatus;
      checklistExtras.push({
        id: "dbs",
        name: "DBS (optional)",
        description: "Upload if you have a basic DBS certificate to share.",
        docType: "dbs",
        status: st,
        matchedIds: docRows.filter((d) => d.doc_type === "dbs").map((d) => d.id),
      });
    }

    if (showOther) {
      checklistExtras.push({
        id: "other",
        name: "Other document",
        description: "Anything else — add a clear label when uploading.",
        docType: "other",
        status: "missing",
        matchedIds: [],
      });
    }

    const checklistMerged = [...checklistWithStatus, ...checklistExtras];

    const documents = await Promise.all(
      docRows.map(async (d) => {
        let viewUrl: string | null = null;
        if (d.file_path) {
          try {
            viewUrl = await getPartnerDocumentSignedUrlWithSupabase(supabase, d.file_path, 3600);
          } catch {
            viewUrl = null;
          }
        }
        return {
          id: d.id,
          name: d.name,
          docType: d.doc_type,
          docTypeLabel: getDocTypeShortLabel(d.doc_type),
          status: d.status,
          fileName: d.file_name ?? null,
          createdAt: d.created_at,
          expiresAt: d.expires_at ?? null,
          viewUrl,
          canDelete:
            d.status === "pending" ||
            d.status === "rejected" ||
            d.status === "approved" ||
            d.status === "expired",
        };
      }),
    );

    const { data: branding } = await supabase
      .from("company_settings")
      .select("company_name, logo_url, logo_light_theme_url")
      .limit(1)
      .maybeSingle();

    const p = partnerRow as Partner & {
      bank_sort_code?: string | null;
      bank_account_number?: string | null;
      bank_account_holder?: string | null;
      bank_name?: string | null;
    };

    const effectiveLegalType = inferPartnerLegal(partnerRow);

    return NextResponse.json({
      expiresAt: session.expiresAt,
      branding: {
        companyName: branding?.company_name ?? "Master",
        logoUrl: branding?.logo_url ?? null,
        logoLightUrl: branding?.logo_light_theme_url ?? null,
      },
      partner: {
        id: p.id,
        companyName: p.company_name,
        contactName: p.contact_name,
        email: p.email,
        phone: p.phone ?? "",
        trade: p.trade,
        trades: p.trades ?? null,
        partnerAddress: p.partner_address ?? "",
        partnerLegalType: p.partner_legal_type ?? null,
        effectiveLegalType,
        crn: p.crn ?? "",
        utr: p.utr ?? "",
        vatRegistered: p.vat_registered ?? null,
        vatNumber: p.vat_number ?? "",
        status: p.status,
        hasBankOnFile: Boolean(
          (p.bank_sort_code && p.bank_sort_code.length > 0) ||
            (p.bank_account_number && p.bank_account_number.length > 0),
        ),
      },
      checklist: checklistMerged,
      documents,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "session_failed" },
      { status: 500 },
    );
  }
}
