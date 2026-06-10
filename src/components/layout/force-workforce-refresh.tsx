"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";

/**
 * Blocks the dashboard and redirects linked workforce users to the onboarding
 * wizard when `profiles.workforce_refresh_required` is set (post-deploy refresh).
 */
export function ForceWorkforceRefresh() {
  const { profile, loading } = useProfile();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const mustRefresh =
    !loading &&
    profile?.workforce_refresh_required === true &&
    profile?.must_change_password !== true;

  useEffect(() => {
    if (!mustRefresh || startedRef.current) return;
    startedRef.current = true;
    setRedirecting(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch("/api/workforce/onboarding/create-refresh-session", {
          method: "POST",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : "Could not start onboarding refresh",
          );
        }
        if (typeof body.onboardingUrl === "string" && body.onboardingUrl.trim()) {
          window.location.assign(body.onboardingUrl);
          return;
        }
        if (body.cleared === true) {
          window.location.reload();
          return;
        }
        throw new Error("No onboarding URL returned");
      } catch (err) {
        startedRef.current = false;
        setRedirecting(false);
        setError(err instanceof Error ? err.message : "Could not start onboarding refresh");
      }
    })();
  }, [mustRefresh]);

  if (!mustRefresh && !redirecting) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="mx-4 max-w-sm rounded-xl border border-border-light bg-card p-6 text-center shadow-lg">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-sm font-medium text-text-primary">
          {error ? "Could not open onboarding" : "Opening onboarding…"}
        </p>
        <p className="mt-1 text-xs text-text-tertiary">
          {error
            ? error
            : "Confirm your details, documents, and contract to continue using Fixfy OS."}
        </p>
        {error ? (
          <button
            type="button"
            className="mt-4 text-sm font-medium text-primary hover:underline"
            onClick={() => {
              startedRef.current = false;
              setError(null);
              setRedirecting(true);
              void fetch("/api/workforce/onboarding/create-refresh-session", { method: "POST" })
                .then(async (res) => {
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(body.error ?? "Failed");
                  if (body.onboardingUrl) window.location.assign(body.onboardingUrl);
                  else if (body.cleared) window.location.reload();
                })
                .catch((e) => {
                  setRedirecting(false);
                  setError(e instanceof Error ? e.message : "Failed");
                });
            }}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
