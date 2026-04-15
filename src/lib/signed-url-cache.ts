/**
 * Module-level memory cache for Supabase Storage signed URLs.
 *
 * Problems this fixes:
 *   - Pages that render avatar photos used to call `createSignedUrl` once
 *     per row per render (N+1). Each call is a ~100–300 ms round-trip.
 *   - Filter/sort changes caused the entire list to re-fetch every URL
 *     even though nothing actually changed.
 *
 * This cache:
 *   - Keys on `${bucket}:${path}:${width}x${height}` (so the same path
 *     can have distinct thumbnail and full-size cached in parallel)
 *   - Stores `{ url, expiresAt }` and returns cached URL when not expired
 *   - Deduplicates concurrent requests for the same key via an in-flight
 *     Promise map so we never fire the same signed URL twice
 *   - Has a safety prune to keep memory bounded
 */

interface Entry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();
let lastPrune = 0;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 55 * 60 * 1000; // Supabase defaults to 1h; refresh early

function pruneExpired(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

export interface SignedUrlCacheOptions {
  width?: number;
  height?: number;
  /** How long to trust a cached URL (ms). Defaults to ~55 min. */
  ttlMs?: number;
}

function keyFor(bucket: string, path: string, opts: SignedUrlCacheOptions): string {
  const w = opts.width ?? 0;
  const h = opts.height ?? 0;
  return `${bucket}:${path}:${w}x${h}`;
}

/**
 * Returns a cached signed URL if fresh, otherwise calls `fetcher` (caller
 * provides the actual Supabase call) and caches the result.
 * Concurrent callers for the same key share a single in-flight Promise.
 */
export async function getCachedSignedUrl(
  bucket: string,
  path: string,
  fetcher: () => Promise<string>,
  opts: SignedUrlCacheOptions = {},
): Promise<string> {
  const now = Date.now();
  pruneExpired(now);

  const key = keyFor(bucket, path, opts);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.url;

  const pending = inflight.get(key);
  if (pending) return pending;

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const promise = fetcher()
    .then((url) => {
      cache.set(key, { url, expiresAt: Date.now() + ttl });
      return url;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Bulk variant: fetcher receives only the uncached paths and must
 *  return them in the same order. Cached paths are resolved instantly. */
export async function getCachedSignedUrlsBatch(
  bucket: string,
  paths: string[],
  fetcher: (uncachedPaths: string[]) => Promise<Array<{ path: string; signedUrl: string }>>,
  opts: SignedUrlCacheOptions = {},
): Promise<Record<string, string>> {
  const now = Date.now();
  pruneExpired(now);

  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const p of paths) {
    const key = keyFor(bucket, p, opts);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      result[p] = cached.url;
    } else {
      missing.push(p);
    }
  }

  if (missing.length === 0) return result;

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetched = await fetcher(missing);
  for (const { path, signedUrl } of fetched) {
    if (!signedUrl) continue;
    const key = keyFor(bucket, path, opts);
    cache.set(key, { url: signedUrl, expiresAt: Date.now() + ttl });
    result[path] = signedUrl;
  }

  return result;
}

export function clearSignedUrlCache(): void {
  cache.clear();
  inflight.clear();
}
