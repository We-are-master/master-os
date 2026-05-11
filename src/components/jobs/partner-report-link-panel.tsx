"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, Send, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";

interface PartnerReportLinkPanelProps {
  jobId:               string;
  hasPartner:          boolean;
  isZendeskLinked:     boolean;
  /** Hide the panel once both reports are already submitted. */
  hideWhenSubmitted?:  boolean;
  bothReportsSubmitted?: boolean;
}

/**
 * Office UI for the partner work-report submission link:
 *   - "Copy link" → fetches the partner-scoped URL from the API, copies it.
 *   - "Send via Zendesk" → posts the link in the partner side conversation
 *     (or falls back to direct email when the job isn't Zendesk-linked).
 *
 * Renders only when a partner is assigned. The link is regenerated server-side
 * on each click so reassigning the partner instantly invalidates older links.
 */
export function PartnerReportLinkPanel({
  jobId,
  hasPartner,
  isZendeskLinked,
  bothReportsSubmitted,
}: PartnerReportLinkPanelProps) {
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  /** Guard against React StrictMode + dep-cycle loops: load the link once per jobId. */
  const fetchedForJobId = useRef<string | null>(null);

  const fetchUrl = useCallback(async (opts: { silent?: boolean } = {}): Promise<string | null> => {
    setLoadingUrl(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/partner-report-link`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.error ?? "Could not load partner link.";
        setLoadError(message);
        if (!opts.silent) toast.error(message);
        return null;
      }
      const body = (await res.json()) as { url?: string };
      const url = body?.url ?? null;
      if (url) setReportUrl(url);
      return url;
    } finally {
      setLoadingUrl(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!hasPartner) return;
    if (fetchedForJobId.current === jobId) return;
    fetchedForJobId.current = jobId;
    void fetchUrl({ silent: true });
    // fetchUrl is intentionally not in deps — `useRef` already guards against
    // double-fire, and React would otherwise loop when deps reference an inner
    // callback whose stale closure includes setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPartner, jobId]);

  const onCopy = useCallback(async () => {
    const url = reportUrl ?? (await fetchUrl());
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Report link copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: open a window with the URL highlighted.
      window.prompt("Copy this link:", url);
    }
  }, [reportUrl, fetchUrl]);

  const onSend = useCallback(async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/send-partner-report-link`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; channel?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? "Could not send the report link.");
        return;
      }
      const channel = body?.channel ?? "";
      const channelLabel =
        channel === "zendesk_side_conv_reply" ? "Sent via Zendesk side conversation."
        : channel === "zendesk_side_conv_open" ? "Side conversation opened with the report link."
        : channel === "resend" ? "Email sent to the partner."
        : "Sent.";
      toast.success(channelLabel);
    } finally {
      setSending(false);
    }
  }, [jobId]);

  if (!hasPartner) {
    return (
      <div
        className="rounded-[10px] p-[14px]"
        style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
      >
        <p className="text-[12px]" style={{ color: "#6B6B70" }}>
          Assign a partner first to generate the report submission link.
        </p>
      </div>
    );
  }

  if (bothReportsSubmitted) return null;

  return (
    <div
      className="rounded-[10px] p-[14px] space-y-3"
      style={{ background: "#F4F5FB", border: "0.5px solid #D8DBEE" }}
    >
      <div className="flex items-start gap-2">
        <Send className="h-4 w-4 shrink-0" style={{ color: "#020040" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: "#020040" }}>
            Send report link to partner
          </p>
          <p className="text-[11px]" style={{ color: "#6B6B70" }}>
            Partner-scoped link — locked to the assigned partner. Reassigning the partner invalidates older links.
          </p>
        </div>
      </div>

      {reportUrl ? (
        <div
          className="rounded-[6px] p-2 text-[11px] font-mono break-all select-all"
          style={{ background: "#FFFFFF", color: "#020040", border: "0.5px solid #D8DBEE" }}
        >
          {reportUrl}
        </div>
      ) : loadingUrl ? (
        <p className="text-[11px]" style={{ color: "#6B6B70" }}>Loading link…</p>
      ) : loadError ? (
        <div className="text-[11px]" style={{ color: "#ED4B00" }}>
          {loadError}
          <button
            type="button"
            onClick={() => void fetchUrl()}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onCopy()}
          disabled={loadingUrl}
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-white px-[12px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40"
          style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[7px] text-[12px] font-semibold cursor-pointer disabled:opacity-40"
          style={{ background: "#020040", color: "#fff" }}
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {sending
            ? "Sending…"
            : isZendeskLinked
              ? "Send via Zendesk"
              : "Email partner"}
        </button>
        {reportUrl ? (
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-white px-[12px] py-[7px] text-[12px] font-medium"
            style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
          >
            <ExternalLink className="h-3 w-3" />
            Preview
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default PartnerReportLinkPanel;
