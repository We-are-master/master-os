import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runOfficeCancelAutoAssignCleanup } from "@/lib/office-cancel-auto-assign-cleanup";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/auto-assign-cancel-cleanup
 * Closes auto-assign offer side conversations and marks invites lost after office cancel.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ ok: false, error: "Missing job id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    await runOfficeCancelAutoAssignCleanup(supabase, id.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auto-assign-cancel-cleanup]", err);
    return NextResponse.json({ ok: false, error: "Cleanup failed." }, { status: 500 });
  }
}
