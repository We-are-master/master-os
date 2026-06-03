"use client";

// Read-only staff view of the partner's reply to an on-hold complaint
// (notes + photos), submitted via the public /job/on-hold form. Fetches
// /api/jobs/[id]/on-hold-submission. Renders nothing until a reply exists.

import { useEffect, useState } from "react";
import { LifeBuoy, Image as ImageIcon, Loader2 } from "lucide-react";

interface Photo {
  id: string;
  url: string | null;
}
interface Submission {
  notes: string | null;
  submittedAt: string | null;
  partnerName: string | null;
  photos: Photo[];
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function JobOnHoldSubmissionCard({ jobId }: { jobId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/jobs/${jobId}/on-hold-submission`);
        const json = await res.json();
        if (!cancelled && res.ok) setSubmission(json.submission ?? null);
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
        <Loader2 className="h-4 w-4 animate-spin" /> Loading partner&apos;s on-hold reply…
      </div>
    );
  }
  if (!submission) return null;

  const when = formatWhen(submission.submittedAt);
  const photos = submission.photos ?? [];

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 p-4 space-y-4 dark:bg-amber-500/5">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-text-primary">Partner&apos;s on-hold reply</h3>
        {submission.partnerName && (
          <span className="text-xs text-text-tertiary">· {submission.partnerName}</span>
        )}
        {when && <span className="ml-auto text-xs text-text-tertiary">{when}</span>}
      </div>

      {submission.notes && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">Solution</p>
          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{submission.notes}</p>
        </div>
      )}

      {photos.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">
            Photos · {photos.length}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((p) =>
              p.url ? (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="On-hold evidence" className="w-full aspect-square object-cover rounded-lg border border-border-light" />
                </a>
              ) : (
                <div key={p.id} className="w-full aspect-square rounded-lg border border-border-light bg-surface flex items-center justify-center text-text-tertiary">
                  <ImageIcon className="h-5 w-5" />
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
