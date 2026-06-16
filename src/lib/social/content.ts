/**
 * Shared helpers for the Social Media Designer content pipeline.
 * Used by the blog/social ingest, approval, and queue API routes.
 */
import { timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "@/lib/app-base-url";

export const FIXFY_BRAND = {
  navy: "#020040",
  navyDeep: "#0a0860",
  orange: "#ED4B00",
  orangeDeep: "#D84300",
  off: "#F7F7FB",
  ink: "#0A0A1F",
  gray: "#6B6B85",
  line: "#E4E4EC",
  white: "#FFFFFF",
} as const;

export type ContentProduct = "fixfy" | "trades" | "general";
export type SocialFormat = "square" | "story" | "landscape";
export type SocialPlatform = "linkedin" | "instagram" | "facebook" | "x";

export const SOCIAL_DIMENSIONS: Record<SocialFormat, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  landscape: { w: 1200, h: 627 },
};

/** Constant-time secret comparison (matches the cron routes). */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Shared API key for n8n → app content ingestion/queue endpoints. */
export function contentApiKey(): string | undefined {
  return process.env.MASTER_OS_CONTENT_API_KEY?.trim() || undefined;
}

/** True when the request carries the right x-api-key header. */
export function hasValidContentKey(headerValue: string | null): boolean {
  return secretsMatch(headerValue?.trim() ?? null, contentApiKey());
}

/** URL-safe slug from a title; appends a short suffix when one is provided. */
export function slugify(input: string, suffix?: string): string {
  const base = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return suffix ? `${base}-${suffix}` : base || "post";
}

/** 1-tap approve/reject link for a queued content row. */
export function approvalUrl(
  kind: "blog" | "social",
  id: string,
  token: string,
  action: "approve" | "reject" = "approve",
): string {
  const base = appBaseUrl().replace(/\/$/, "");
  return `${base}/api/content/${kind}/${id}/${action}?token=${encodeURIComponent(token)}`;
}
