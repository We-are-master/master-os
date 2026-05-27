"use client";

// Read-only staff view of what the partner captured in the Fixfy Trade Portal for a job:
// the checklist + before/after photos. Fetches /api/jobs/[id]/partner-media. Renders nothing
// until there's something to show.

import { useEffect, useState } from "react";
import { CheckSquare, Square, Image as ImageIcon, Loader2 } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  required: boolean;
  note: string | null;
}
interface Photo {
  id: string;
  kind: "before" | "after";
  url: string | null;
}

export function JobPartnerMediaCard({ jobId }: { jobId: string }) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/jobs/${jobId}/partner-media`);
        const json = await res.json();
        if (!cancelled && res.ok) {
          setChecklist(json.checklist ?? []);
          setPhotos(json.photos ?? []);
        }
      } catch {
        /* leave empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border-light bg-surface p-4 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading partner updates…
      </div>
    );
  }
  if (checklist.length === 0 && photos.length === 0) return null;

  const done = checklist.filter((c) => c.done).length;
  const before = photos.filter((p) => p.kind === "before");
  const after = photos.filter((p) => p.kind === "after");

  const PhotoRow = ({ title, items }: { title: string; items: Photo[] }) =>
    items.length === 0 ? null : (
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1.5">{title}</p>
        <div className="grid grid-cols-4 gap-2">
          {items.map((p) =>
            p.url ? (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={title} className="w-full aspect-square object-cover rounded-lg border border-border-light" />
              </a>
            ) : (
              <div key={p.id} className="w-full aspect-square rounded-lg border border-border-light bg-surface flex items-center justify-center text-text-tertiary">
                <ImageIcon className="h-5 w-5" />
              </div>
            ),
          )}
        </div>
      </div>
    );

  return (
    <div className="rounded-xl border border-border-light bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Partner updates</h3>
        <span className="text-xs text-text-tertiary">from the Trade Portal</span>
      </div>

      {checklist.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">
            Checklist · {done}/{checklist.length} done
          </p>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                {c.done ? <CheckSquare className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" /> : <Square className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />}
                <span className={c.done ? "text-text-secondary line-through" : "text-text-primary"}>
                  {c.label}
                  {c.required && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">REQ</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length > 0 && (
        <div className="space-y-3">
          <PhotoRow title="Before" items={before} />
          <PhotoRow title="After" items={after} />
        </div>
      )}
    </div>
  );
}
