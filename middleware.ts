import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware runs on EVERY request, so it's the hottest path in the app.
 *
 * Key optimisations:
 *  1. Fast-path API routes with only security headers — no auth work, no cookie
 *     rewrites. Individual API routes already enforce auth via `supabase.auth.getUser()`.
 *  2. Fast-path public routes (login, join, partner-upload) with only security
 *     headers — no Supabase client at all.
 *  3. For protected routes, detect "has session cookie" locally via
 *     `request.cookies` in O(1). Only instantiate the Supabase client when
 *     cookies are present and we need to refresh them.
 *  4. Never call `supabase.auth.getUser()` here — that's a synchronous network
 *     round-trip to the Supabase Auth API (~100-400ms). `getSession()` reads the
 *     cookie locally; downstream RSCs still call `getUser()` when they actually
 *     need the verified user object.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ─── Fast path 1: API routes ──────────────────────────────────────────────
  // API handlers enforce their own auth. Middleware only adds security headers.
  if (pathname.startsWith("/api")) {
    const res = NextResponse.next({ request });
    addSecurityHeaders(res, pathname);
    return res;
  }

  // ─── Fast path 2: public pages ────────────────────────────────────────────
  const isLoginPage    = pathname.startsWith("/login");
  const allowsAnonymous =
    isLoginPage ||
    pathname.startsWith("/partner-upload") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/payment-success") ||
    pathname.startsWith("/quote/");

  // ─── Detect session cookie without instantiating Supabase client ──────────
  // Supabase sets cookies named `sb-<project-ref>-auth-token*`. We only need to
  // know whether one exists to gate protected routes.
  const hasSessionCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  // Anonymous user hitting a protected page → redirect to /login immediately,
  // no Supabase client needed.
  if (!hasSessionCookie && !allowsAnonymous) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    addSecurityHeaders(redirect, pathname);
    return redirect;
  }

  // Already-logged-in user hitting /login → bounce to dashboard.
  if (hasSessionCookie && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    const redirect = NextResponse.redirect(url);
    addSecurityHeaders(redirect, pathname);
    return redirect;
  }

  // ─── Slow path: refresh session cookies when they exist ───────────────────
  // `getSession()` reads the cookie locally (no network), but it may need to
  // rotate refresh tokens; we still need to forward the rotated cookies. If no
  // session cookie is present and the route is public, skip the client entirely.
  if (!hasSessionCookie) {
    const res = NextResponse.next({ request });
    addSecurityHeaders(res, pathname);
    return res;
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Reads cookie only (no network). Cookie rotation still works via setAll.
  await supabase.auth.getSession();

  addSecurityHeaders(supabaseResponse, pathname);
  return supabaseResponse;
}

/**
 * `DENY` breaks same-origin iframes (e.g. quote drawer PDF preview loading `/api/quotes/send-pdf`).
 * `SAMEORIGIN` still blocks embedding on other sites.
 */
function addSecurityHeaders(res: NextResponse, pathname?: string) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  const allowSameOriginFrame =
    pathname === "/api/quotes/send-pdf" || pathname === "/api/quotes/email-preview";
  res.headers.set("X-Frame-Options", allowSameOriginFrame ? "SAMEORIGIN" : "DENY");
  res.headers.set("X-XSS-Protection", "1; mode=block");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
