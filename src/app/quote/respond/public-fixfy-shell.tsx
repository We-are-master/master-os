"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export const FIXFY_NAVY = "#020040";
export const FIXFY_ORANGE = "#ED4B00";
export const FIXFY_MUTED = "#6B6B85";
export const FIXFY_BORDER = "#E4E4EC";
export const FIXFY_BG = "#F7F7FB";

type ShellSize = "md" | "lg";

export function FixfyPublicShell({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: ShellSize;
  className?: string;
}) {
  const maxW = size === "lg" ? "max-w-lg" : "max-w-md";
  return (
    <div className={`flex min-h-screen items-center justify-center p-4 sm:p-6 ${className}`} style={{ background: FIXFY_BG }}>
      <div
        className={`flex w-full ${maxW} max-h-[min(100vh-2rem,920px)] flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(2,0,64,0.08)]`}
        style={{ borderColor: FIXFY_BORDER }}
      >
        {children}
      </div>
    </div>
  );
}

export function FixfyPublicHeader({ eyebrow }: { eyebrow?: string }) {
  return (
    <div style={{ background: FIXFY_NAVY }}>
      <div className="flex flex-col items-center justify-center px-6 py-5">
        {eyebrow ? (
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: FIXFY_ORANGE }}
          >
            {eyebrow}
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logos/fixfy-email-header.png"
          alt="Fixfy"
          width={132}
          height={20}
          className="h-auto w-[108px] max-w-[36%] sm:w-[132px]"
        />
      </div>
      <div className="h-1" style={{ background: "linear-gradient(90deg,#ED4B00 0%,#FF7A29 100%)" }} />
    </div>
  );
}

type StatusVariant = "success" | "warning" | "error" | "info";

const STATUS_STYLES: Record<
  StatusVariant,
  { icon: typeof CheckCircle2; iconBg: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, iconBg: "#E4F5EE", iconColor: "#0F6E56" },
  warning: { icon: AlertTriangle, iconBg: "#FFF1EB", iconColor: "#ED4B00" },
  error:   { icon: AlertTriangle, iconBg: "#FBE3E7", iconColor: "#C8102E" },
  info:    { icon: Info, iconBg: "#E8F4FD", iconColor: "#0B5FFF" },
};

export function FixfyPublicStatus({
  variant,
  title,
  message,
  badge,
  footer,
}: {
  variant: StatusVariant;
  title: string;
  message: ReactNode;
  badge?: string;
  footer?: ReactNode;
}) {
  const s = STATUS_STYLES[variant];
  const Icon = s.icon;
  return (
    <FixfyPublicShell>
      <FixfyPublicHeader eyebrow="Fixfy partner" />
      <div className="flex flex-1 flex-col px-6 py-8 text-center sm:px-8">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: s.iconBg, color: s.iconColor }}
        >
          <Icon className="h-7 w-7" strokeWidth={2} />
        </div>
        {badge ? (
          <span
            className="mx-auto mt-4 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ background: FIXFY_BG, color: FIXFY_NAVY, border: `1px solid ${FIXFY_BORDER}` }}
          >
            {badge}
          </span>
        ) : null}
        <h1 className="mt-4 text-[20px] font-bold leading-tight" style={{ color: FIXFY_NAVY }}>
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: FIXFY_MUTED }}>
          {message}
        </p>
        {footer ? <div className="mt-6">{footer}</div> : null}
        <p className="mt-auto pt-8 text-[11px] leading-relaxed" style={{ color: FIXFY_MUTED }}>
          Need help?{" "}
          <a href="mailto:support@getfixfy.com" className="font-semibold underline" style={{ color: FIXFY_ORANGE }}>
            support@getfixfy.com
          </a>
        </p>
      </div>
    </FixfyPublicShell>
  );
}

export function FixfyPublicLoading({ message = "Loading…" }: { message?: string }) {
  return (
    <FixfyPublicShell>
      <FixfyPublicHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: FIXFY_ORANGE }} />
        <p className="text-[14px] font-medium" style={{ color: FIXFY_MUTED }}>{message}</p>
      </div>
    </FixfyPublicShell>
  );
}

/** Scrollable body below the shared header — used by report/bid forms. */
export function FixfyPublicScrollBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto">{children}</div>;
}
