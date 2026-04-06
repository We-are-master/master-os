import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api");
  const isAuthPage = pathname.startsWith("/login");

  // API routes: do not redirect; let the route return 401 if unauthenticated
  if (isApiRoute) {
    addSecurityHeaders(supabaseResponse, pathname);
    return supabaseResponse;
  }

  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    addSecurityHeaders(redirect, pathname);
    return redirect;
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    const redirect = NextResponse.redirect(url);
    addSecurityHeaders(redirect, pathname);
    return redirect;
  }

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
