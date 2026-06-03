"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { signIn } from "@/services/auth";
import "@/app/(auth)/login/fixfy-login.css";

export function FixfyLoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [loading, setLoading] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      toast.success("Welcome back!");
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lg-simple-root">
      <header className="lg-top">
        <Link className="lg-brand" href="/" aria-label="Fixfy home">
          <img src="/logos/fixfy-wordmark.png" alt="Fixfy" className="lg-brand__logo" />
        </Link>
        <Link className="lg-partner-link" href="/partners">
          Become a partner
        </Link>
        <span className="lg-status">
          <span className="lg-status__dot" />
          All systems operational
        </span>
      </header>

      <main className="lg-wrap">
        <form className="lg-card" onSubmit={handleSubmit}>
          <div className="lg-card__kk">Internal access</div>
          <h1 className="lg-card__title">Sign in to {APP_NAME}</h1>
          <p className="lg-card__lede">Use your workspace account to pick up where you left off.</p>

          <div className="lg-field">
            <label className="lg-field__lbl" htmlFor="lg-email">
              Work email
            </label>
            <div className="lg-input">
              <Mail strokeWidth={2} />
              <input
                id="lg-email"
                type="email"
                autoComplete="email"
                placeholder="you@fixfy.co.uk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="lg-field">
            <label className="lg-field__lbl" htmlFor="lg-password">
              <span>Password</span>
              <a href="#forgot">Forgot?</a>
            </label>
            <div className="lg-input">
              <Lock strokeWidth={2} />
              <input
                id="lg-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <button
                type="button"
                className="lg-input__toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
              </button>
            </div>
          </div>

          <div className="lg-row">
            <label className="lg-check">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
              />
              Keep me signed in on this device
            </label>
          </div>

          <button className="lg-submit" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
            {!loading ? <ArrowRight strokeWidth={2} /> : null}
          </button>

          <div className="lg-access">
            <div>
              <div className="lg-access__kk">Not on the team yet?</div>
              <div className="lg-access__text">
                Operators, ops leads and partner managers can request a workspace.
              </div>
            </div>
            <a href="#request-access">
              Request access <ArrowUpRight strokeWidth={2} />
            </a>
          </div>
        </form>
      </main>

      <footer className="lg-foot">
        <span>© Fixfy 2026</span>
        <span className="lg-sep">·</span>
        <a href="#privacy">Privacy</a>
        <span className="lg-sep">·</span>
        <a href="#terms">Terms</a>
        <span className="lg-sep">·</span>
        <a href="#status">Status</a>
        <div className="lg-foot__right">
          <span>UK only · GDPR</span>
        </div>
      </footer>
    </div>
  );
}
