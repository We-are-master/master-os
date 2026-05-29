"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type State =
  | { kind: "loading" }
  | { kind: "ok"; jobReference: string; partnerLabel: string; alreadyConfirmed: boolean }
  | { kind: "taken"; jobReference: string | null }
  | { kind: "error"; message: string };

const PORTAL_URL =
  (process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim().replace(/\/$/, "")) || "https://app.getfixfy.com";

export function ConfirmClient() {
  const search = useSearchParams();
  const token = search.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "Invalid link — missing token." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jobs/confirm-acceptance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.ok) {
          if (j.error === "job_taken") {
            setState({ kind: "taken", jobReference: j.jobReference ?? null });
            return;
          }
          setState({
            kind:    "error",
            message: j.message ?? friendlyError(j.error) ?? "We couldn't confirm this job. Please contact support.",
          });
          return;
        }
        setState({
          kind:             "ok",
          jobReference:     j.jobReference,
          partnerLabel:     j.partnerLabel,
          alreadyConfirmed: Boolean(j.alreadyConfirmed),
        });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Network error" });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg,#020034 0%,#0D006E 55%,#E94A02 100%)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center">
        {state.kind === "loading" && (
          <>
            <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-5" />
            <h1 className="text-xl font-bold text-slate-800">Confirming…</h1>
            <p className="text-slate-500 text-sm mt-2">Hang on a second.</p>
          </>
        )}

        {state.kind === "ok" && (
          <>
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2">
              {state.alreadyConfirmed ? "Already confirmed" : "Job confirmed!"}
            </h1>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              {state.alreadyConfirmed
                ? `Job ${state.jobReference} is already booked to you.`
                : `Thanks ${state.partnerLabel}. Job ${state.jobReference} is booked — we've sent the brief and earnings details to your inbox.`}
            </p>
            <a
              href={PORTAL_URL}
              className="inline-flex items-center justify-center w-full px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm transition-colors"
            >
              Open partner portal
            </a>
          </>
        )}

        {state.kind === "taken" && (
          <>
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-5">
              <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2">Taken by another partner</h1>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              {state.jobReference
                ? `Job ${state.jobReference} was accepted by another partner before you. Thanks for being quick — we'll send the next one your way.`
                : `This job was accepted by another partner before you. Thanks for being quick — we'll send the next one your way.`}
            </p>
            <a
              href={PORTAL_URL}
              className="inline-flex items-center justify-center w-full px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm transition-colors"
            >
              Open partner portal
            </a>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
              <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2">Couldn't confirm</h1>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">{state.message}</p>
            <p className="text-xs text-slate-400">
              Reply to the email or contact{" "}
              <a href="mailto:support@getfixfy.com" className="text-orange-500 underline">support@getfixfy.com</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function friendlyError(code: string | undefined): string | null {
  switch (code) {
    case "invalid_or_expired_token":
      return "This link is invalid or has expired. Reply to your email and we'll send a new one.";
    case "job_not_found":
      return "We couldn't find this job — it may have been deleted.";
    case "partner_mismatch":
      return "This job is no longer assigned to you.";
    case "missing_token":
      return "The confirmation link is incomplete. Open the original email and try again.";
    default:
      return null;
  }
}
