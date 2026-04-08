export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-24 rounded-lg bg-surface-tertiary animate-pulse" />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="h-7 w-72 rounded bg-surface-tertiary animate-pulse" />
          <div className="h-4 w-96 rounded bg-surface-tertiary animate-pulse" />
        </div>
        <div className="h-9 w-32 rounded-lg bg-surface-tertiary animate-pulse" />
      </div>

      {/* Status + progress strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-tertiary animate-pulse" />
        ))}
      </div>

      {/* Body — two column layout placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-64 rounded-xl bg-surface-tertiary animate-pulse" />
          <div className="h-48 rounded-xl bg-surface-tertiary animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-48 rounded-xl bg-surface-tertiary animate-pulse" />
          <div className="h-48 rounded-xl bg-surface-tertiary animate-pulse" />
        </div>
      </div>
    </div>
  );
}
