/**
 * Loading skeleton shown while the server component fetches the initial
 * Requests payload. Mirrors the eventual page layout (header + KPI cards
 * + filter bar + table) so the layout shift is minimal when the real page
 * streams in.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-surface-tertiary animate-pulse" />
          <div className="h-4 w-64 rounded bg-surface-tertiary animate-pulse" />
        </div>
        <div className="h-9 w-32 rounded-lg bg-surface-tertiary animate-pulse" />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-tertiary animate-pulse" />
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-3">
        <div className="h-10 flex-1 rounded-lg bg-surface-tertiary animate-pulse" />
        <div className="h-10 w-32 rounded-lg bg-surface-tertiary animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="h-12 bg-surface-tertiary animate-pulse" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-14 border-t border-border bg-card animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
