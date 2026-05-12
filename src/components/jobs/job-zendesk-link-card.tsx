"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

interface JobZendeskLinkCardProps {
  jobId:              string;
  externalSource:     string | null | undefined;
  externalRef:        string | null | undefined;
  zendeskSubdomain?:  string | null;
  /** Called after a successful link/unlink so the parent can refresh job state. */
  onChanged?:         () => void;
}

/**
 * Office UI to link or unlink a job to a Zendesk ticket by typing the ticket
 * id. Persists `(external_source = 'zendesk', external_ref = <ticketId>)` on
 * the job — that pair is what every Zendesk integration in the codebase keys
 * off (status sync trigger, side conversations, partner report dispatches).
 *
 * Differs from the legacy Finance-tab "Ticket ID" input which only saved
 * `external_ref` and forgot to set `external_source`, leaving the link
 * invisible to the integration.
 */
export function JobZendeskLinkCard({
  jobId,
  externalSource,
  externalRef,
  zendeskSubdomain,
  onChanged,
}: JobZendeskLinkCardProps) {
  const isLinked = externalSource === "zendesk" && !!externalRef?.trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((externalRef ?? "").trim());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft((externalRef ?? "").trim());
  }, [externalRef]);

  const save = async (ticketId: string | null) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/zendesk-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? "Could not update Zendesk link.");
        return;
      }
      toast.success(ticketId ? "Linked to Zendesk ticket." : "Zendesk link removed.");
      setEditing(false);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const ticketHref =
    isLinked && zendeskSubdomain
      ? `https://${zendeskSubdomain}.zendesk.com/agent/tickets/${encodeURIComponent(String(externalRef))}`
      : null;

  return (
    <div
      className="rounded-[10px] p-[14px] space-y-2"
      style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0" style={{ color: "#020040" }} />
        <p className="text-[13px] font-semibold" style={{ color: "#020040" }}>
          Zendesk ticket
        </p>
        {isLinked && !editing ? (
          <span
            className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "#E4F5EE", color: "#0F6E56" }}
          >
            Linked
          </span>
        ) : null}
      </div>

      {!editing && isLinked ? (
        <div className="flex items-center gap-2 flex-wrap">
          <code
            className="text-[12px] px-2 py-1 rounded"
            style={{ background: "#FFFFFF", color: "#020040", border: "0.5px solid #E4E4E8" }}
          >
            #{externalRef}
          </code>
          {ticketHref ? (
            <a
              href={ticketHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: "#020040" }}
            >
              <ExternalLink className="h-3 w-3" />
              Open in Zendesk
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-[6px] bg-white px-2 py-1 text-[11px] font-medium cursor-pointer"
            style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
          >
            <Pencil className="h-3 w-3" />
            Change
          </button>
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-[6px] bg-white px-2 py-1 text-[11px] font-medium cursor-pointer disabled:opacity-40"
            style={{ color: "#ED4B00", border: "0.5px solid #F5CFB8" }}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Unlink
          </button>
        </div>
      ) : !editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px]" style={{ color: "#6B6B70" }}>
            Not linked. Paste the ticket id to start syncing this job with the support team.
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold cursor-pointer"
            style={{ background: "#020040", color: "#fff" }}
          >
            <Link2 className="h-3 w-3" />
            Link ticket
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. 12345"
            className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
            autoFocus
          />
          <p className="text-[11px]" style={{ color: "#6B6B70" }}>
            Stored as <code className="font-mono">external_source=&apos;zendesk&apos;</code> + <code className="font-mono">external_ref</code>. Existing status sync + partner side conversation flows pick this up automatically.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void save(draft.trim() || null)}
              disabled={saving || draft.trim() === (externalRef ?? "").trim()}
              className="inline-flex items-center gap-1 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: "#020040", color: "#fff" }}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {draft.trim() ? "Save link" : "Unlink"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft((externalRef ?? "").trim());
                setEditing(false);
              }}
              className="inline-flex items-center gap-1 rounded-[6px] bg-white px-3 py-1.5 text-[12px] font-medium cursor-pointer"
              style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default JobZendeskLinkCard;
