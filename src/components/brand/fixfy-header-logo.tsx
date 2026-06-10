import { cn } from "@/lib/utils";

/** Official white-on-navy header strip (600×88 source). */
const HEADER_LOGO_SRC = "/logos/fixfy-email-header.png";
const HEADER_LOGO_ASPECT = 600 / 88;

type FixfyHeaderLogoProps = {
  className?: string;
  /** Rendered logo height in CSS px */
  height?: number;
  alt?: string;
};

export function FixfyHeaderLogo({ className, height = 32, alt = "Fixfy" }: FixfyHeaderLogoProps) {
  const width = Math.round(height * HEADER_LOGO_ASPECT);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={HEADER_LOGO_SRC}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      className={cn("block h-auto max-w-full object-contain object-left", className)}
      style={{ height }}
    />
  );
}
