import { NextResponse } from "next/server";
import type { AuthResult } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";

/** Staff who can manage partners (directory / invites). */
export async function requirePartnersStaffAuth(
  auth: AuthResult,
): Promise<NextResponse | null> {
  const gate = await requireStaffPermission(auth, "partners");
  return gate instanceof NextResponse ? gate : null;
}
