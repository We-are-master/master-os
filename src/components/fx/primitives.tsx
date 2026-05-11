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
        "inline-flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-fx-coral",
        className,
      )}
    >
      <span className="fx-live-dot" />
      {label}
    </span>
  );
}

type PillTone = "neutral" | "ok" | "warn" | "bad" | "coral" | "info" | "violet" | "ghost";

const PILL_TONE: Record<PillTone, string> = {
  neutral: "bg-fx-paper-2 text-fx-slate",
  ok: "bg-fx-green-50 text-fx-green",
  warn: "bg-fx-amber-50 text-fx-amber",
  bad: "bg-fx-red-50 text-fx-red",
  coral: "bg-fx-coral-50 text-fx-coral-p",
  info: "bg-fx-blue-50 text-fx-blue",
  violet: "bg-[#EDE7F6] text-[#5B21B6]",
  ghost: "bg-transparent border border-fx-line text-fx-slate",
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
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-mono text-[10.5px] font-medium uppercase tracking-[0.05em] whitespace-nowrap",
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
    <div
      className={cn(
        "bg-card border border-fx-line rounded-xl shadow-fx-1 overflow-hidden",
        className,
      )}
    >
      {(title || subtitle || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-fx-line">
          <div className="min-w-0">
            {title && <div className="text-[14px] font-semibold text-text-primary leading-tight">{title}</div>}
            {subtitle && <div className="fx-kk mt-1.5">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </div>
  );
}

type KpiVariant = "default" | "coral" | "alert";

export function KpiCard({
  label,
  hint,
  value,
  sub,
  trend,
  trendDirection,
  variant = "default",
  topRight,
}: {
  label: string;
  /** Optional hint shown as a subtle "!" icon next to the label with a hover popover. */
  hint?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: React.ReactNode;
  trendDirection?: "up" | "down" | "neutral";
  variant?: KpiVariant;
  topRight?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card px-4 py-4 transition-colors",
        variant === "default" && "border-fx-line hover:border-fx-line-2",
        variant === "coral" &&
          "border-fx-coral/25 bg-gradient-to-b from-card to-fx-coral-50/30",
        variant === "alert" &&
          "border-fx-red/25 bg-gradient-to-b from-card to-fx-red-50/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="fx-kk inline-flex items-center gap-1.5">
          {label}
          {hint && <FixfyHintIcon text={hint} />}
        </span>
        {topRight}
      </div>
      <div
        className={cn(
          "mt-2 font-medium tabular-nums tracking-[-0.02em] leading-[1.1] text-[24px]",
          variant === "coral" && "text-fx-coral-p",
          variant === "alert" && "text-fx-red",
          variant === "default" && "text-text-primary",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 font-mono text-[11.5px] text-fx-mute">{sub}</div>}
      {trend && (
        <div
          className={cn(
            "absolute top-3.5 right-4 font-mono text-[11px] flex items-center gap-1",
            trendDirection === "down" ? "text-fx-red" : "text-fx-green",
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
  coral: "bg-fx-coral-50 text-fx-coral-p",
  blue: "bg-fx-blue-50 text-fx-blue",
  green: "bg-fx-green-50 text-fx-green",
  navy: "bg-fx-navy/10 text-fx-navy",
  neutral: "bg-fx-paper-2 text-fx-slate",
};

export function FxAvatar({
  initials,
  tone = "neutral",
  size = "md",
}: {
  initials: string;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-full font-semibold tracking-[0.02em] shrink-0",
        size === "md" ? "h-7 w-7 text-[11px]" : "h-[22px] w-[22px] text-[9.5px]",
        AVATAR_TONE[tone],
      )}
    >
      {initials}
    </span>
  );
}
