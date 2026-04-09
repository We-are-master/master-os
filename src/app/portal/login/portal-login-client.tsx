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

  // Show a helpful message if the user landed here from an expired link.
  useEffect(() => {
    if (initialError === "link_expired") {
      setError("That sign-in link has expired. Enter your email below to get a new one.");
    } else if (initialError === "invalid_link") {
      setError("That sign-in link is invalid. Enter your email below to get a new one.");
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
              src="https://wearemaster.com/favicon.png"
              alt="Master"
              className="w-12 h-12 object-contain"
            />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Account Portal</h1>
          <p className="text-white/55 text-sm mt-1">Sign in to manage your account with Master</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-7">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-black text-slate-800 mb-2">Check your email</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-4">
                If <span className="font-semibold text-slate-700">{email}</span> is registered with us,
                you&rsquo;ll receive a sign-in link shortly. The link will sign you in directly &mdash;
                no password needed.
              </p>
              <p className="text-xs text-slate-400">
                Didn&rsquo;t receive it after a few minutes? Check your spam folder or contact{" "}
                <a href="mailto:hello@wearemaster.com" className="text-orange-600 font-medium">
                  hello@wearemaster.com
                </a>
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(""); }}
                className="mt-6 text-sm text-slate-500 hover:text-slate-700 underline"
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
                <a href="mailto:hello@wearemaster.com" className="text-orange-600 font-medium">
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
