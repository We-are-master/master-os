import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Public branding for login / unauthenticated screens.
 * Uses service role when configured; otherwise callers should fall back to client `getCompanySettings` if RLS allows anon.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("company_settings")
      .select("company_name, logo_url, logo_light_theme_url, logo_dark_theme_url")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(emptyPayload());
    }

    return NextResponse.json({
      companyName: data.company_name ?? "",
      logoUrl: data.logo_url ?? null,
      logoLightThemeUrl: data.logo_light_theme_url ?? null,
      logoDarkThemeUrl: data.logo_dark_theme_url ?? null,
    });
  } catch {
    return NextResponse.json(emptyPayload());
  }
}

function emptyPayload() {
  return {
    companyName: "",
    logoUrl: null as string | null,
    logoLightThemeUrl: null as string | null,
    logoDarkThemeUrl: null as string | null,
  };
}
