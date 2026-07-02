/**
 * Shared Fixfy PDF layout: page margins, footer reserve, keep-together blocks, header logo sizing.
 */

import React from "react";
import { View } from "@react-pdf/renderer";

export const FIXFY_PDF_PAGE_GAP = 28;
export const FIXFY_PDF_PAD_H = 48;
export const FIXFY_PDF_FOOTER_HEIGHT = 72;
export const FIXFY_PDF_PAGE_BOTTOM_RESERVE = FIXFY_PDF_FOOTER_HEIGHT + FIXFY_PDF_PAGE_GAP;
export const FIXFY_PDF_HEADER_LOGO_HEIGHT = 40;
export const FIXFY_PDF_HEADER_LOGO_WIDTH = 132;
export const FIXFY_PDF_NAVY = "#020040";
export const FIXFY_PDF_ORANGE = "#ED4B00";
export const FIXFY_PDF_WHITE = "#ffffff";

export const fixfyPdfHeaderLogoStyle = {
  width: FIXFY_PDF_HEADER_LOGO_WIDTH,
  height: FIXFY_PDF_HEADER_LOGO_HEIGHT,
  objectFit: "contain" as const,
  objectPosition: "left center" as const,
};

export const fixfyPdfPageMargins = {
  paddingTop: FIXFY_PDF_PAGE_GAP,
  paddingBottom: FIXFY_PDF_PAGE_BOTTOM_RESERVE,
};

export const fixfyPdfFooterGuardStyle = {
  position: "absolute" as const,
  bottom: FIXFY_PDF_FOOTER_HEIGHT,
  left: 0,
  right: 0,
  height: FIXFY_PDF_PAGE_GAP,
  backgroundColor: FIXFY_PDF_WHITE,
};

export const fixfyPdfFooterShellStyle = {
  position: "absolute" as const,
  bottom: 0,
  left: 0,
  right: 0,
  height: FIXFY_PDF_FOOTER_HEIGHT,
  backgroundColor: FIXFY_PDF_NAVY,
};

/** White band above the fixed footer on every page. */
export function FixfyPdfFooterGuard(): React.ReactElement {
  return <View style={fixfyPdfFooterGuardStyle} fixed />;
}

/** Keep a block on one page; if it cannot start with enough room, move it down entirely. */
export function KeepTogetherBlock({
  children,
  minHeight,
  style,
}: {
  children: React.ReactNode;
  minHeight: number;
  style?: React.ComponentProps<typeof View>["style"];
}): React.ReactElement {
  return (
    <View style={style} wrap={false} minPresenceAhead={FIXFY_PDF_PAGE_BOTTOM_RESERVE + minHeight}>
      {children}
    </View>
  );
}
