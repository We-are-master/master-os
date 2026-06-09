import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { sendInvoiceEmail } from "@/lib/invoice-send-email";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { invoiceId?: unknown; requestPercent?: unknown; jobId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const jobId = typeof body.jobId === "string" && isValidUUID(body.jobId.trim()) ? body.jobId.trim() : undefined;
  if (!invoiceId || !isValidUUID(invoiceId)) {
    return NextResponse.json({ error: "Valid invoiceId is required" }, { status: 400 });
  }

  let requestPercent: number | undefined;
  if (body.requestPercent !== undefined && body.requestPercent !== null) {
    const n = Number(body.requestPercent);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: "requestPercent must be between 0 and 100" }, { status: 400 });
    }
    requestPercent = n;
  }

  const profileClient = await createClient();
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || auth.user.email || "User";

  const admin = createServiceClient();
  const result = await sendInvoiceEmail(admin, invoiceId, {
    userId: auth.user.id,
    userName,
    requestPercent,
    jobId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    to: result.to,
    cc: result.cc,
    resendId: result.resendId,
  });
}
