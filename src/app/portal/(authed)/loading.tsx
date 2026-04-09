export default function Loading() {
  return (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-surface-tertiary animate-pulse" />
        <div className="h-4 w-96 rounded bg-surface-tertiary animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface-tertiary animate-pulse" />
        ))}
      </div>
      <div className="bg-card rounded-2xl border border-border p-6 space-y-3">
        <div className="h-5 w-40 rounded bg-surface-tertiary animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-surface-tertiary animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}
