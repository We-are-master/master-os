import { NextRequest, NextResponse } from "next/server";
import { hasValidContentKey } from "@/lib/social/content";
import { resolvePhoto, type Orientation } from "@/lib/social/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORIENTATIONS: Orientation[] = ["square", "portrait", "landscape"];

/**
 * Picks one real photo for a post/blog (owned bank first, then Pexels).
 * Auth: x-api-key === MASTER_OS_CONTENT_API_KEY.
 *
 * Query: ?q=plumber&theme=plumbing&orientation=square
 * Returns: { url, source, alt, credit } | { url: null }
 */
export async function GET(req: NextRequest) {
  if (!hasValidContentKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const query = sp.get("q") || "";
  const theme = sp.get("theme");
  const orientation = (ORIENTATIONS.includes(sp.get("orientation") as Orientation)
    ? sp.get("orientation")
    : "square") as Orientation;

  const photo = await resolvePhoto({ query, theme, orientation });
  return NextResponse.json(photo ?? { url: null });
}
