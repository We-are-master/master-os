import { revalidateTag } from "next/cache";
import { CACHE_TAGS, type CacheTag } from "./query-cache";

/**
 * Convenience wrappers for invalidating groups of cache tags after mutations.
 *
 * Call these from API route handlers (server actions) after a write:
 *
 *     await supabase.from("partners").update(...);
 *     invalidatePartners();
 *
 * Tag-level invalidation is cheap (O(1)) and surgical — only the cached reads
 * that list the tag are dropped. Other cached reads stay warm.
 */

/**
 * Next 15 requires a cache profile string. "default" matches the profile
 * inferred from `unstable_cache({ revalidate })`.
 */
const PROFILE = "default" as const;

function bust(tag: CacheTag): void {
  revalidateTag(tag, PROFILE);
}

export function invalidateJobs(): void {
  bust(CACHE_TAGS.jobs);
  bust(CACHE_TAGS.statusCounts);
}

export function invalidatePartners(): void {
  bust(CACHE_TAGS.partners);
  bust(CACHE_TAGS.statusCounts);
}

export function invalidateQuotes(): void {
  bust(CACHE_TAGS.quotes);
  bust(CACHE_TAGS.statusCounts);
}

export function invalidateRequests(): void {
  bust(CACHE_TAGS.requests);
  bust(CACHE_TAGS.statusCounts);
}

export function invalidateInvoices(): void {
  bust(CACHE_TAGS.invoices);
  bust(CACHE_TAGS.jobs); // invoices hang off jobs
}

export function invalidateClients(): void {
  bust(CACHE_TAGS.clients);
}

export function invalidateSelfBills(): void {
  bust(CACHE_TAGS.selfBills);
  bust(CACHE_TAGS.jobs);
}

export function invalidateBills(): void {
  bust(CACHE_TAGS.bills);
}

export function invalidateAccounts(): void {
  bust(CACHE_TAGS.accounts);
  bust(CACHE_TAGS.clients);
}

export function invalidateConfig(): void {
  bust(CACHE_TAGS.config);
}

/** Fine-grained: invalidate an arbitrary tag. */
export function invalidateTag(tag: CacheTag): void {
  bust(tag);
}
