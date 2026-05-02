"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function PortalLoginClient() {
  const params = useSearchParams();
  const initialError = params.get("error");

  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // OTP code state — alternative to clicking the magic link.
  // Supabase sends both a link and a 6-digit code in the same email.
  const [code, setCode]         = useState("");
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Show a helpful message if the user landed here from an expired link.
  useEffect(() => {
    if (initialError === "link_expired") {
      setError("That sign-in link has expired. Enter your email below to get a new one.");
    } else if (initialError === "invalid_link") {
      setError("That sign-in link is invalid. Enter your email below to get a new one.");
    } else if (initialError === "not_portal_user") {
      setError(
        "This email is not registered as a portal user. If you're a Fixfy team member, sign in at /login instead.",
      );
    }
  }, [initialError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/magic-link", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Always show the same success message regardless of whether the email
      // is registered — never confirm/deny existence of accounts.
      if (res.ok || res.status === 429) {
        const json = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(json?.error ?? "Too many sign-in attempts. Please try again in a few minutes.");
        } else {
          setSent(true);
        }
      } else {
        // For unexpected server errors, still show the generic success
        // message — don't leak server state.
        setSent(true);
      }
    } catch {
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    const cleaned = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      setOtpError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/portal/auth/verify-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          email: email.trim().toLowerCase(),
          token: cleaned,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtpError(typeof json.error === "string" ? json.error : "That code didn't work. Please try again.");
        setVerifying(false);
        return;
      }
      // Success — the auth cookie is set on the response. Use a full
      // browser navigation (NOT router.push) so the next request goes
      // through the middleware with the freshly-set cookie. router.push
      // would race the cookie propagation and cause an immediate redirect
      // back to /portal/login.
      window.location.assign("/portal");
    } catch (err) {
      console.error("[portal/login] verify error:", err);
      setOtpError("We could not verify your code. Please try again.");
      setVerifying(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg,#020034 0%,#0D006E 55%,#E94A02 100%)" }}
    >
      <div className="w-full max-w-md">
        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: "0 8px 32px rgba(233,74,2,0.35)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/favicon.svg"
              alt="Fixfy"
              className="w-12 h-12 object-contain"
            />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Account Portal</h1>
          <p className="text-white/55 text-sm mt-1">Sign in to manage your account with Fixfy</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-7">
          {sent ? (
            <div>
              <div className="text-center mb-5">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-black text-slate-800 mb-2">Check your email</h2>
                <p className="text-slate-500 text-sm leading-relaxed">
                  If <span className="font-semibold text-slate-700">{email}</span> is registered with us,
                  you&rsquo;ll receive a sign-in link <strong>and a 6-digit code</strong> shortly.
                </p>
              </div>

              {/* OTP code input — alternative to clicking the link */}
              <form onSubmit={handleVerifyOtp} className="border-t border-slate-100 pt-5">
                <p className="text-xs font-semibold text-slate-500 mb-3 text-center uppercase tracking-wide">
                  Or enter the 6-digit code
                </p>

                {otpError && (
                  <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">
                    {otpError}
                  </div>
                )}

                <input
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-2xl font-bold text-center tracking-[0.5em] tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition mb-4"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  autoComplete="one-time-code"
                  disabled={verifying}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={verifying || code.length !== 6}
                  className="w-full py-3 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "linear-gradient(90deg,#FF6B2B,#E94A02)" }}
                >
                  {verifying ? "Verifying..." : "Sign in with code"}
                </button>
              </form>

              <p className="text-xs text-slate-400 mt-5 text-center">
                Didn&rsquo;t receive it? Check your spam folder or{" "}
                <a href="mailto:support@getfixfy.com" className="text-orange-600 font-medium">
                  contact us
                </a>
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setCode(""); setOtpError(null); }}
                className="mt-3 w-full text-sm text-slate-500 hover:text-slate-700 underline text-center"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-bold text-slate-800 mb-1">Sign in</h2>
              <p className="text-sm text-slate-500 mb-5">
                Enter the email address linked to your account. We&rsquo;ll send you a sign-in link.
              </p>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                Email address
              </label>
              <input
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition mb-5"
                type="text"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
                disabled={loading}
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(90deg,#FF6B2B,#E94A02)" }}
              >
                {loading ? "Sending link..." : "Send sign-in link"}
              </button>

              <p className="text-xs text-slate-400 text-center mt-5">
                Don&rsquo;t have an account?{" "}
                <a href="mailto:support@getfixfy.com" className="text-orange-600 font-medium">
                  Contact us
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
