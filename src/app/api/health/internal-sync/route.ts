import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/internal-sync
 * Confirms INTERNAL_SYNC_SECRET is set (trade portal accept + internal routes). No secret values exposed.
 */
export async function GET() {
  const hasSecret = Boolean(process.env.INTERNAL_SYNC_SECRET?.trim());
  return NextResponse.json(
    {
      ok: hasSecret,
      internalSyncConfigured: hasSecret,
      ...(hasSecret
        ? {}
        : {
            hint: "Set INTERNAL_SYNC_SECRET on master-os production — must match the trade portal value.",
          }),
    },
    { status: hasSecret ? 200 : 503 },
  );
}
