import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";

export function MicroLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("fx-kk", className)}>{children}</span>;
}

export function LiveIndicator({
  label = "Live",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[11px] font-medium text-fx-mute",
        className,
      )}
    >
      <span className="fx-live-dot" />
      {label}
    </span>
  );
}

type PillTone = "neutral" | "ok" | "warn" | "bad" | "coral" | "info" | "violet" | "ghost";

/** UNO chip tones: colour is state; coral, violet and ghost fall back to neutral. */
const PILL_TONE: Record<PillTone, string> = {
  neutral: "bg-surface-tertiary text-text-primary",
  ok: "bg-success-light text-[var(--ok-ink)]",
  warn: "bg-warning-light text-[var(--warn-ink)]",
  bad: "bg-danger-light text-[var(--bad-ink)]",
  coral: "bg-surface-tertiary text-text-primary",
  info: "bg-info-light text-[var(--info-ink)]",
  violet: "bg-surface-tertiary text-text-primary",
  ghost: "bg-surface-tertiary text-text-primary",
};

export function Pill({
  tone = "neutral",
  dot = true,
  children,
  className,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] px-2 py-[2px] rounded-[6px] text-[11px] font-medium leading-[1.45] whitespace-nowrap",
        PILL_TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  bodyClassName,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    // VOS UNO Insights card (`ins-card`): soft gradient panel, shallow two-layer
    // shadow, head 12/600 in text-secondary (sub in 11 text-tertiary), body 4/14/12.
    <div className={cn("ins-card overflow-hidden", className)}>
      {(title || subtitle || actions) && (
        <div className="flex items-start justify-between gap-2.5 px-3.5 pt-3">
          <div className="min-w-0">
            {title && <div className="truncate text-[12px] font-semibold text-text-secondary">{title}</div>}
            {subtitle && <div className="mt-0.5 min-w-0 truncate text-[11px] text-text-tertiary">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("px-3.5 pb-3 pt-2", bodyClassName)}>{children}</div>
    </div>
  );
}

type KpiVariant = "default" | "coral" | "alert";

export function KpiCard({
  label,
  hint,
  value,
  countAbove,
  countBesideHint,
  sub,
  trend,
  trendDirection,
  variant = "default",
  topRight,
  onShowDetails,
  detailsLabel = "Show breakdown",
}: {
  label: string;
  /** Optional hint shown as a subtle "!" icon next to the label with a hover popover. */
  hint?: string;
  value: React.ReactNode;
  /** Smaller count/metric rendered above the main value (e.g. job count above £ total). */
  countAbove?: React.ReactNode;
  /** Count shown in orange next to the hint icon (instead of countAbove). */
  countBesideHint?: React.ReactNode;
  sub?: React.ReactNode;
  trend?: React.ReactNode;
  trendDirection?: "up" | "down" | "neutral";
  variant?: KpiVariant;
  topRight?: React.ReactNode;
  /** When set, renders a clickable info icon next to the label that opens a breakdown modal. */
  onShowDetails?: () => void;
  detailsLabel?: string;
}) {
  return (
    <div
      className={cn(
        // VOS UNO Insights metric card: same shell for every variant; only the number takes status colour.
        "ins-card relative overflow-hidden px-3.5 pb-2.5 pt-2.5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-[5px] text-[12px] font-semibold text-text-secondary">
          {label}
          {hint && <FixfyHintIcon text={hint} placement="top-start" />}
          {countBesideHint != null && countBesideHint !== "" ? (
            <span className="text-[11px] font-semibold tabular-nums text-text-tertiary leading-none">
              {countBesideHint}
            </span>
          ) : null}
          {onShowDetails && (
            <button
              type="button"
              onClick={onShowDetails}
              aria-label={detailsLabel}
              title={detailsLabel}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-fx-mute hover:bg-fx-paper hover:text-text-primary transition-colors"
            >
              <Info className="h-3 w-3" />
            </button>
          )}
        </span>
        {topRight}
      </div>
      {countAbove != null && countAbove !== "" && countBesideHint == null ? (
        <div className="mt-2 text-[11px] text-fx-mute tabular-nums leading-none">{countAbove}</div>
      ) : null}
      <div
        className={cn(
          "ins-v font-semibold tabular-nums tracking-[-0.03em] leading-[1.1] text-[20px]",
          countAbove != null && countAbove !== "" && countBesideHint == null ? "mt-1" : "mt-1.5",
          variant === "coral" && "text-text-primary",
          variant === "alert" && "text-fx-red",
          variant === "default" && "text-text-primary",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-fx-mute">{sub}</div>}
      {trend && (
        <div
          className={cn(
            "absolute top-3 right-3.5 inline-flex items-center gap-1 rounded-[6px] px-2 py-[2px] text-[11px] font-medium",
            trendDirection === "down" ? "bg-danger-light text-[var(--bad-ink)]" : "bg-success-light text-[var(--ok-ink)]",
          )}
        >
          {trend}
        </div>
      )}
    </div>
  );
}

type Tone = "coral" | "blue" | "green" | "navy" | "neutral";
const AVATAR_TONE: Record<Tone, string> = {
  coral: "bg-surface-tertiary text-text-secondary",
  blue: "bg-surface-tertiary text-text-secondary",
  green: "bg-surface-tertiary text-text-secondary",
  navy: "bg-surface-tertiary text-text-secondary",
  neutral: "bg-surface-tertiary text-text-secondary",
};

export function FxAvatar({
  initials,
  tone = "neutral",
  size = "md",
  src,
  alt,
}: {
  initials: string;
  tone?: Tone;
  size?: "sm" | "md";
  /** When provided, renders a real photo; falls back to initials on load error. */
  src?: string | null;
  alt?: string;
}) {
  const sizing = size === "md" ? "h-7 w-7 text-[11px]" : "h-[22px] w-[22px] text-[11px]";

  if (src) {
    return (
      <span
        className={cn(
          "relative inline-block rounded-full overflow-hidden shrink-0 ring-1 ring-fx-line",
          sizing,
        )}
        title={alt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? initials}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={(e) => {
            // Hide the broken image; the initials fallback below shows through.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span
          className={cn(
            "absolute inset-0 inline-grid place-items-center rounded-full font-semibold tracking-[0.02em] -z-10",
            AVATAR_TONE[tone],
          )}
        >
          {initials}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-full font-semibold tracking-[0.02em] shrink-0",
        sizing,
        AVATAR_TONE[tone],
      )}
    >
      {initials}
    </span>
  );
}
