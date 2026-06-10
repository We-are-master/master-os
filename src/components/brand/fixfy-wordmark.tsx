import { cn } from "@/lib/utils";

const NAVY = "#020040";
const CORAL = "#ED4B00";

type FixfyWordmarkProps = {
  className?: string;
  /** Total mark height in px */
  height?: number;
  /** White logo for navy/dark headers (standard brand). */
  variant?: "onLight" | "onDark";
};

function FixfyMarkIcon({ height, color }: { height: number; color: string }) {
  const width = Math.round(height * 1.05);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0"
    >
      <g fill={color} transform="translate(32 33)">
        <path d="M0-20a20 20 0 0 1 17.32 30L13.4 7.74A14 14 0 1 0 0-6a14 14 0 0 0 4.94.9l5.66 9.8A20 20 0 1 1 0-20z M-3.5-19.7l-1.4-7.3 8.8 0-1.4 7.3a20 20 0 0 0-6 0z M-15.7-13l-6.4-3.7 4.4-7.6 5 5.4a20 20 0 0 0-3 5.9z M19.7-7l7.3 1.4 0 8.8-7.3-1.4a20 20 0 0 0 0-8.8z M15.7 13l6.4 3.7-4.4 7.6-5-5.4a20 20 0 0 0 3-5.9z" />
        <g transform="rotate(35)">
          <rect x="-1.5" y="-14" width="3" height="20" rx="1" />
          <rect x="-8" y="-18" width="16" height="7" rx="1.5" />
        </g>
      </g>
    </svg>
  );
}

/** Crisp vector wordmark — onLight (navy header) or onDark (standard white on navy). */
export function FixfyWordmark({ className, height = 34, variant = "onLight" }: FixfyWordmarkProps) {
  const fontSize = Math.round(height * 0.68);
  const onDark = variant === "onDark";
  const iconColor = onDark ? "#FFFFFF" : NAVY;

  return (
    <div
      className={cn("inline-flex min-w-0 max-w-full items-center gap-2.5", className)}
      style={{ height }}
      role="img"
      aria-label="Fixfy"
    >
      <FixfyMarkIcon height={height} color={iconColor} />
      <span
        className="truncate font-semibold leading-none tracking-[-0.03em]"
        style={{
          fontSize,
          fontFamily: "var(--sans, 'Geist', 'Inter', -apple-system, sans-serif)",
        }}
      >
        {onDark ? (
          <span style={{ color: "#FFFFFF" }}>fixfy</span>
        ) : (
          <>
            <span style={{ color: NAVY }}>fix</span>
            <span style={{ color: CORAL }}>fy</span>
          </>
        )}
      </span>
    </div>
  );
}
