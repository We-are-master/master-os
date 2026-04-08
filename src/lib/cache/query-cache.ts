import { unstable_cache } from "next/cache";

/**
 * Shared tag-based cache keys for the whole app.
 *
 * Mutation handlers call `revalidateTag(CACHE_TAGS.partners)` (etc.) to bust
 * the corresponding cached reads. Keep this list in sync with the tags passed
 * to {@link cachedQuery} below.
 */
export const CACHE_TAGS = {
  jobs:       "jobs",
  partners:   "partners",
  quotes:     "quotes",
  requests:   "requests",
  invoices:   "invoices",
  clients:    "clients",
  selfBills:  "self-bills",
  bills:      "bills",
  accounts:   "accounts",
  config:     "config",
  statusCounts: "status-counts",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Reasonable defaults — lists expire faster than config. */
export const CACHE_TTL = {
  list:   30,  // seconds — list pages (refreshes every 30s)
  detail: 60,  // seconds — single-entity detail views
  config: 300, // seconds — company config, dashboard views, etc.
} as const;

/**
 * Wrap an async read function with Next.js `unstable_cache`.
 *
 * Usage:
 *
 *     const getPartnerList = cachedQuery(
 *       "partners-list",
 *       (filter: Filter) => listPartnersRaw(filter),
 *       { tags: [CACHE_TAGS.partners], revalidate: CACHE_TTL.list },
 *     );
 *
 *     const rows = await getPartnerList({ status: "active" });
 *
 * The cache key is `keyPrefix + JSON.stringify(args)` — deterministic and
 * scoped per tenant (args should include any filter/user inputs).
 */
export function cachedQuery<Args extends readonly unknown[], Result>(
  keyPrefix: string,
  fn: (...args: Args) => Promise<Result>,
  opts: { tags: CacheTag[]; revalidate?: number } = { tags: [], revalidate: CACHE_TTL.list },
): (...args: Args) => Promise<Result> {
  // unstable_cache wants a `string[]` key — we derive it at call time so the
  // wrapped function can be called with different args and still hit the cache.
  return async (...args: Args): Promise<Result> => {
    const wrapped = unstable_cache(
      async () => fn(...args),
      [keyPrefix, JSON.stringify(args)],
      {
        tags: opts.tags,
        revalidate: opts.revalidate ?? CACHE_TTL.list,
      },
    );
    return wrapped();
  };
}
