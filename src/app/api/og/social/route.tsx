import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { FIXFY_BRAND, SOCIAL_DIMENSIONS, type SocialFormat } from "@/lib/social/content";

export const runtime = "nodejs";

type BgKind = "navy" | "light" | "orange";

const FONT_BASE = "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest";

async function loadFont(weight: 400 | 600 | 800): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${FONT_BASE}/latin-${weight}-normal.ttf`);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

const SIZING: Record<SocialFormat, { pad: string; logo: number; eye: number; h1: number; sub: number; center: boolean }> = {
  square: { pad: "84px", logo: 46, eye: 19, h1: 64, sub: 27, center: false },
  story: { pad: "260px 84px 300px", logo: 52, eye: 21, h1: 76, sub: 30, center: true },
  landscape: { pad: "62px 72px", logo: 40, eye: 18, h1: 58, sub: 25, center: false },
};

function palette(bg: BgKind) {
  if (bg === "navy")
    return {
      bg: `linear-gradient(135deg, ${FIXFY_BRAND.navyDeep} 0%, ${FIXFY_BRAND.navy} 60%)`,
      fg: FIXFY_BRAND.white,
      sub: "rgba(255,255,255,0.72)",
      eye: FIXFY_BRAND.orange,
      logoLight: true,
      shape: "rgba(255,255,255,0.05)",
    };
  if (bg === "orange")
    return {
      bg: `linear-gradient(135deg, ${FIXFY_BRAND.orange} 0%, ${FIXFY_BRAND.orangeDeep} 70%)`,
      fg: FIXFY_BRAND.white,
      sub: "rgba(255,255,255,0.92)",
      eye: "rgba(255,255,255,0.85)",
      logoLight: true,
      shape: "rgba(255,255,255,0.10)",
    };
  return {
    bg: FIXFY_BRAND.off,
    fg: FIXFY_BRAND.ink,
    sub: FIXFY_BRAND.gray,
    eye: FIXFY_BRAND.orange,
    logoLight: false,
    shape: "rgba(2,0,64,0.04)",
  };
}

/**
 * On-brand social image renderer for the Social Media Designer.
 * GET /api/og/social?format=square&bg=navy&eyebrow=...&title=...&sub=...
 * `title` may contain \n for explicit line breaks.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = (["square", "story", "landscape"].includes(sp.get("format") || "")
    ? sp.get("format")
    : "square") as SocialFormat;
  const bg = (["navy", "light", "orange"].includes(sp.get("bg") || "") ? sp.get("bg") : "navy") as BgKind;
  const photo = (sp.get("photo") || "").trim();

  const eyebrow = (sp.get("eyebrow") || "").slice(0, 60);
  const title = (sp.get("title") || "Home services, sorted.").slice(0, 160);
  const sub = (sp.get("sub") || "").slice(0, 220);

  const { w, h } = SOCIAL_DIMENSIONS[format];
  const S = SIZING[format];
  const P = palette(bg);
  if (photo) {
    // Photo mode: white text over a navy scrim, regardless of bg.
    P.fg = FIXFY_BRAND.white;
    P.sub = "rgba(255,255,255,0.88)";
    P.eye = FIXFY_BRAND.orange;
    P.logoLight = true;
  }
  const origin = req.nextUrl.origin;
  const logoUrl = `${origin}/logos/${P.logoLight ? "fixfy-wordmark-white-trim.png" : "fixfy-wordmark-navy-trim.png"}`;

  const [w400, w600, w800] = await Promise.all([loadFont(400), loadFont(600), loadFont(800)]);
  const fonts = [
    w400 && { name: "Inter", data: w400, weight: 400 as const, style: "normal" as const },
    w600 && { name: "Inter", data: w600, weight: 600 as const, style: "normal" as const },
    w800 && { name: "Inter", data: w800, weight: 800 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 600 | 800; style: "normal" }[];

  const lines = title.split("\n");

  return new ImageResponse(
    (
      <div
        style={{
          width: w,
          height: h,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: photo ? FIXFY_BRAND.navy : P.bg,
          color: P.fg,
          fontFamily: "Inter, sans-serif",
          padding: S.pad,
        }}
      >
        {/* photo background + navy scrim (photo mode) */}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            width={w}
            height={h}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: w, height: h, objectFit: "cover" }}
          />
        ) : null}
        {photo ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: w,
              height: h,
              display: "flex",
              background:
                "linear-gradient(180deg, rgba(2,0,64,0.55) 0%, rgba(2,0,64,0.12) 30%, rgba(2,0,64,0.55) 66%, rgba(2,0,64,0.95) 100%)",
            }}
          />
        ) : null}

        {/* decorative brand shape (graphic mode only) */}
        {!photo ? (
          <div
            style={{
              position: "absolute",
              right: -h * 0.18,
              bottom: -h * 0.18,
              width: h * 0.6,
              height: h * 0.6,
              borderRadius: h * 0.3,
              background: P.shape,
              display: "flex",
            }}
          />
        ) : null}

        {/* logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} height={S.logo} alt="Fixfy" style={{ objectFit: "contain" }} />

        {/* content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: S.center ? "auto" : "auto",
            marginBottom: S.center ? "auto" : 0,
            maxWidth: w - 160,
            zIndex: 2,
          }}
        >
          {eyebrow ? (
            <div
              style={{
                display: "flex",
                color: P.eye,
                fontSize: S.eye,
                fontWeight: 600,
                letterSpacing: 3,
                textTransform: "uppercase",
                marginBottom: 22,
              }}
            >
              {eyebrow}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column" }}>
            {lines.map((ln, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  fontSize: S.h1,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: -1.5,
                }}
              >
                {ln}
              </div>
            ))}
          </div>

          {sub ? (
            <div
              style={{
                display: "flex",
                color: P.sub,
                fontSize: S.sub,
                fontWeight: 400,
                lineHeight: 1.45,
                marginTop: 26,
                maxWidth: w - 280,
              }}
            >
              {sub}
            </div>
          ) : null}
        </div>

        {/* footer */}
        <div
          style={{
            position: "absolute",
            left: format === "landscape" ? 72 : 84,
            bottom: format === "story" ? 210 : 54,
            display: "flex",
            alignItems: "center",
            color: P.sub,
            fontSize: S.eye + 1,
            fontWeight: 600,
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: FIXFY_BRAND.orange,
              marginRight: 12,
              display: "flex",
            }}
          />
          getfixfy.com
        </div>
      </div>
    ),
    { width: w, height: h, ...(fonts.length ? { fonts } : {}) },
  );
}
