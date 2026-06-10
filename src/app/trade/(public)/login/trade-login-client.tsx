"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "./trade-login.css";

function tradePortalRedirectUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    "/"
  );
}

type AuthTab = "signin" | "create";

export function TradeLoginClient() {
  const params = useSearchParams();
  const initialError = params.get("error");
  const initialTab = params.get("tab") === "create" ? "create" : "signin";

  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [email, setEmail] = useState(() => params.get("email")?.trim().toLowerCase() ?? "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
    return () => {
      document.documentElement.style.height = "";
      document.body.style.height = "";
      document.body.style.margin = "";
    };
  }, []);

  useEffect(() => {
    if (initialError === "link_expired") {
      setError("That sign-in link has expired. Enter your email to get a new code.");
    } else if (initialError === "invalid_link") {
      setError("That sign-in link is invalid. Enter your email to get a new code.");
    } else if (initialError === "not_partner") {
      setError(
        "This email is not linked to a Fixfy Trade partner account. Apply below or contact support.",
      );
      setTab("create");
    }
  }, [initialError]);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid work email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trade/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.ok || res.status === 429) {
        const json = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(json?.error ?? "Too many sign-in attempts. Please try again in a few minutes.");
        } else {
          setSent(true);
        }
      } else {
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
      const res = await fetch("/api/trade/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: cleaned,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtpError(typeof json.error === "string" ? json.error : "That code didn't work. Try again.");
        setVerifying(false);
        return;
      }
      window.location.assign(tradePortalRedirectUrl());
    } catch (err) {
      console.error("[trade/login] verify error:", err);
      setOtpError("We could not verify your code. Please try again.");
      setVerifying(false);
    }
  }

  return (
    <div className="tp-root">
      <section className="tp-brand" aria-label="Fixfy Trade">
        <div className="tp-brand__inner">
          <p className="tp-brand__help">
            Need help?{" "}
            <a href="mailto:support@getfixfy.com">Contact support</a>
          </p>

          <div className="tp-wordmark" aria-label="Fixfy Trade">
            <span className="tp-wordmark__fix">fix</span>
            <span className="tp-wordmark__trade">Trade</span>
          </div>
          <p className="tp-eyebrow">Fixfy Trade · Partner Network</p>

          <h1 className="tp-headline">
            Grow your revenue. <em>Guaranteed pipeline.</em>
          </h1>
          <p className="tp-lede">
            Stop chasing leads. Fixfy Trade puts vetted jobs, faster payouts and a full business OS in
            your hands — built for trades who want to scale, not survive.
          </p>

          <div className="tp-benefits">
            <div className="tp-benefit">
              <span className="tp-benefit__dot" aria-hidden />
              <div>
                <p className="tp-benefit__title">Jobs sent to you — not the other way around</p>
                <p className="tp-benefit__text">
                  Qualified local work matched to your trade and postcode. More booked days, less
                  empty diary.
                </p>
              </div>
            </div>
            <div className="tp-benefit">
              <span className="tp-benefit__dot" aria-hidden />
              <div>
                <p className="tp-benefit__title">Get paid faster — we invoice, you cash in</p>
                <p className="tp-benefit__text">
                  Weekly self-bill payouts on a clear schedule. No chasing clients for money.
                </p>
              </div>
            </div>
            <div className="tp-benefit">
              <span className="tp-benefit__dot" aria-hidden />
              <div>
                <p className="tp-benefit__title">Run the business like a business</p>
                <p className="tp-benefit__text">
                  Quotes, schedule, team and invoices in one place — so you can focus on revenue, not
                  admin.
                </p>
              </div>
            </div>
          </div>

          <div className="tp-stats">
            <div>
              <p className="tp-stat__val">2,400+</p>
              <p className="tp-stat__lbl">partners</p>
            </div>
            <div>
              <p className="tp-stat__val">£4.8m</p>
              <p className="tp-stat__lbl">paid out</p>
            </div>
            <div>
              <p className="tp-stat__val">4.8★</p>
              <p className="tp-stat__lbl">rating</p>
            </div>
          </div>
        </div>
      </section>

      <section className="tp-auth" aria-label="Sign in">
        <div className="tp-auth__inner">
          <div className="tp-toggle" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signin"}
              className={`tp-toggle__btn${tab === "signin" ? " is-active" : ""}`}
              onClick={() => {
                setTab("signin");
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "create"}
              className={`tp-toggle__btn${tab === "create" ? " is-active" : ""}`}
              onClick={() => {
                setTab("create");
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          {tab === "create" ? (
            <div className="tp-create-panel">
              <h2 className="tp-auth__title">Join Fixfy Trade</h2>
              <p>
                <strong>More revenue. Less admin. Guaranteed work pipeline.</strong> Apply in minutes
                and start receiving jobs matched to your trade — partners on Fixfy Trade grow
                turnover because the OS handles quoting, scheduling and payouts for them.
              </p>
              <div className="tp-pill-row">
                <span className="tp-pill">Vetted jobs</span>
                <span className="tp-pill">Weekly payouts</span>
                <span className="tp-pill">No Google sign-in</span>
              </div>
              <Link href="/join" className="tp-submit" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
                Start your application
              </Link>
              <p className="tp-footnote">
                Already a partner?{" "}
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 font-bold text-[#ed4b00] cursor-pointer"
                  onClick={() => setTab("signin")}
                >
                  Sign in with your work email
                </button>
              </p>
            </div>
          ) : sent ? (
            <div>
              <h2 className="tp-auth__title">Check your email</h2>
              <p className="tp-auth__sub">
                If <strong>{email}</strong> is registered, you&rsquo;ll get a 6-digit sign-in code
                shortly. No password. No Google — just your work email.
              </p>

              <form onSubmit={handleVerifyOtp} style={{ marginTop: 24 }}>
                <label className="tp-field__lbl" htmlFor="tp-otp">
                  6-digit code
                </label>
                <input
                  id="tp-otp"
                  className="tp-input tp-input--otp"
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
                {otpError ? <div className="tp-error">{otpError}</div> : null}
                <button type="submit" className="tp-submit" disabled={verifying || code.length !== 6}>
                  {verifying ? "Verifying…" : "Sign in"}
                </button>
              </form>

              <p className="tp-footnote">
                Didn&rsquo;t receive it? Check spam or{" "}
                <a href="mailto:support@getfixfy.com">contact support</a>
              </p>
              <button
                type="button"
                className="mt-3 w-full border-0 bg-transparent text-sm text-[#6b6b85] underline cursor-pointer"
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setOtpError(null);
                }}
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendCode}>
              <h2 className="tp-auth__title">Sign in</h2>
              <p className="tp-auth__sub">
                We&rsquo;ll email you a 6-digit sign-in code. No password to remember — and we
                don&rsquo;t use Google sign-in.
              </p>

              {error ? <div className="tp-error">{error}</div> : null}

              <div className="tp-field">
                <label className="tp-field__lbl" htmlFor="tp-email">
                  Work email
                </label>
                <input
                  id="tp-email"
                  className="tp-input"
                  type="email"
                  placeholder="you@yourcompany.co.uk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  disabled={loading}
                  required
                />
              </div>

              <button type="submit" className="tp-submit" disabled={loading}>
                {loading ? "Sending code…" : "Send code"}
              </button>

              <p className="tp-footnote">
                New to Fixfy?{" "}
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 font-bold text-[#ed4b00] cursor-pointer"
                  onClick={() => setTab("create")}
                >
                  Start your application
                </button>
              </p>
            </form>
          )}

          <p className="tp-auth__footer">© 2026 Fixfy · partners.getfixfy.com</p>
        </div>
      </section>
    </div>
  );
}
