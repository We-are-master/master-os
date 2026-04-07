import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import {
  generatePartnerPortalTokenRaw,
  generatePartnerPortalShortCode,
  hashPartnerPortalToken,
} from "@/lib/partner-portal-crypto";
import { getPartnerPortalAllowlistIds } from "@/lib/partner-portal-allowlist";
import type { Partner } from "@/types/database";

export const dynamic = "force-dynamic";

function appOrigin(): string {
  const u =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";
  if (!u) return "";
  if (u.startsWith("http")) return u.replace(/\/$/, "");
  return `https://${u.replace(/\/$/, "")}`;
}

/**
 * Admin-only: create a time-limited partner portal URL (document upload + profile).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabaseUser = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: profile } = await supabaseUser.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  let partnerId: string;
  let expiresInDays = 14;
  let requestedDocIds: string[] = [];
  try {
    const body = (await req.json()) as {
      partnerId?: string;
      expiresInDays?: number;
      requestedDocIds?: unknown;
    };
    partnerId = String(body.partnerId ?? "").trim();
    if (typeof body.expiresInDays === "number" && body.expiresInDays >= 1 && body.expiresInDays <= 90) {
      expiresInDays = body.expiresInDays;
    }
    if (Array.isArray(body.requestedDocIds)) {
      requestedDocIds = body.requestedDocIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Invalid partnerId" }, { status: 400 });
  }

  if (requestedDocIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one document type to request before generating the link." },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data: partnerRow, error: exErr } = await admin.from("partners").select("*").eq("id", partnerId).maybeSingle();
  if (exErr || !partnerRow) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  const partner = partnerRow as Partner;
  const allow = new Set(getPartnerPortalAllowlistIds(partner));
  const invalid = requestedDocIds.filter((id) => !allow.has(id));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid document selection: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const raw = generatePartnerPortalTokenRaw();
  const tokenHash = hashPartnerPortalToken(raw);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  let insertErr: { message: string; code?: string } | null = null;
  let shortCode: string | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePartnerPortalShortCode();
    const { error } = await admin.from("partner_portal_tokens").insert({
      partner_id: partnerId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      requested_doc_ids: requestedDocIds,
      short_code: code,
    });
    if (!error) {
      shortCode = code;
      insertErr = null;
      break;
    }
    insertErr = error;
    const msg = (error.message ?? "").toLowerCase();
    const isDup = error.code === "23505" || msg.includes("duplicate") || msg.includes("unique");
    if (!isDup) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  if (!shortCode && insertErr) {
    return NextResponse.json(
      { error: insertErr.message ?? "Could not create portal link (try again)." },
      { status: 500 },
    );
  }

  const origin = appOrigin();
  const path = `/partner-upload?token=${encodeURIComponent(raw)}`;
  const url = origin ? `${origin}${path}` : path;
  const pathShort = shortCode ? `/partner-upload?code=${encodeURIComponent(shortCode)}` : path;
  const shortUrl = origin ? `${origin}${pathShort}` : pathShort;

  return NextResponse.json({
    url,
    shortUrl,
    expiresAt: expiresAt.toISOString(),
    message: origin ? undefined : "Set NEXT_PUBLIC_APP_URL to return an absolute URL.",
  });
}
