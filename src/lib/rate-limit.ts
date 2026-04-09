/**
 * In-memory IP rate limiter for Next.js API routes.
 *
 * Uses a single Map keyed by `${routeKey}:${ip}` with a sliding window.
 * Adequate for stopping trivial abuse (registration spam, password reset
 * brute force, quote token churn) on a single Vercel region.
 *
 * Limitations:
 *  - In-memory state is per-instance — Vercel may run multiple instances,
 *    so an attacker could in theory spread requests across instances. The
 *    cap is still much tighter than no cap, and we can swap to Upstash KV
 *    later by replacing the implementation behind `checkRateLimit`.
 *  - Memory is bounded by a periodic prune (every 5 min by default).
 *
 * Usage in a route handler:
 *
 *   const rl = checkRateLimit(`join:${ip}`, 5, 10 * 60 * 1000);
 *   if (!rl.ok) {
 *     return NextResponse.json(
 *       { error: "Too many requests. Please try again later." },
 *       { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
 *     );
 *   }
 */
import type { NextRequest } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

function pruneExpired(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (existing.count >= max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, max - existing.count),
    retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client IP extraction. Vercel sets `x-forwarded-for` and
 * `x-real-ip`. Falls back to a constant string when no IP can be derived
 * (which still lets us rate-limit globally as a degraded mode).
 */
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
