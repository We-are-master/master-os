"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Loader2, Mail, Share2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appBaseUrl } from "@/lib/app-base-url";

type PublishResult = {
  liveUrl: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
  publishedAt: string;
  totalActive: number;
  warnings?: string[];
};

export type CatalogShareVariant = "client" | "partner";

const VARIANT_CONFIG: Record<
  CatalogShareVariant,
  {
    livePath: string;
    publishApi: string;
    pdfApi: string;
    sendApi: string;
    title: string;
    subtitle: string;
    emailPlaceholder: string;
    pdfHint: string;
  }
> = {
  client: {
    livePath: "/catalog",
    publishApi: "/api/service-catalog/publish",
    pdfApi: "/api/service-catalog/pdf?download=1",
    sendApi: "/api/service-catalog/send",
    title: "Share rate card",
    subtitle: "Client-facing prices — live page plus published PDF and HTML on public storage.",
    emailPlaceholder: "client@example.com",
    pdfHint: "Generates a client PDF from the current catalog. Also uploaded to public storage when you share.",
  },
  partner: {
    livePath: "/catalog/partner",
    publishApi: "/api/partner-service-catalog/publish",
    pdfApi: "/api/partner-service-catalog/pdf?download=1",
    sendApi: "/api/partner-service-catalog/send",
    title: "Share partner rate card",
    subtitle: "Partner pay rates — live page plus published PDF and HTML on public storage.",
    emailPlaceholder: "partner@example.com",
    pdfHint: "Generates a partner PDF from the current catalog. Also uploaded to public storage when you share.",
  },
};

type CatalogShareModalProps = {
  open: boolean;
  onClose: () => void;
  variant?: CatalogShareVariant;
};

function resolveCatalogLiveUrl(livePath: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}${livePath}`;
  }
  return `${appBaseUrl()}${livePath}`;
}

export function CatalogShareModal({ open, onClose, variant = "client" }: CatalogShareModalProps) {
  const config = VARIANT_CONFIG[variant];
  const [liveUrl, setLiveUrl] = useState(() => resolveCatalogLiveUrl(config.livePath));

  useEffect(() => {
    setLiveUrl(resolveCatalogLiveUrl(config.livePath));
  }, [open, config.livePath]);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [copied, setCopied] = useState<"live" | "pdf" | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState(false);

  const runPublish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(config.publishApi, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Publish failed");
      setPublished(data as PublishResult);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Could not publish rate card");
    } finally {
      setPublishing(false);
    }
  }, [config.publishApi]);

  useEffect(() => {
    if (!open) return;
    setSendOk(false);
    setSendError(null);
    void runPublish();
  }, [open, runPublish]);

  async function copyText(text: string, which: "live" | "pdf") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }

  async function handleDownloadPdf() {
    window.open(config.pdfApi, "_blank", "noopener,noreferrer");
  }

  async function handleSendEmail() {
    setSending(true);
    setSendError(null);
    setSendOk(false);
    try {
      const res = await fetch(config.sendApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          recipientName: recipientName || undefined,
          message: message || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Send failed");
      setSendOk(true);
      if (data.pdfUrl) {
        setPublished((prev) =>
          prev
            ? { ...prev, pdfUrl: data.pdfUrl, liveUrl: data.liveUrl ?? prev.liveUrl }
            : prev,
        );
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send email");
    } finally {
      setSending(false);
    }
  }

  const pdfUrl = published?.pdfUrl ?? null;
  const htmlUrl = published?.htmlUrl ?? null;
  const idPrefix = variant === "partner" ? "partner-catalog" : "catalog";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config.title}
      subtitle={config.subtitle}
      size="lg"
    >
      <div className="space-y-6">
        {publishing ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Publishing latest snapshot…
          </div>
        ) : null}
        {publishError ? (
          <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100/90">
            {publishError}
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => void runPublish()}
            >
              Retry
            </button>
          </p>
        ) : null}
        {published?.warnings && published.warnings.length > 0 ? (
          <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100/90">
            {published.warnings.join(" ")}
          </p>
        ) : null}

        <section className="space-y-3 rounded-xl border border-border-light bg-surface-hover/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Share2 className="h-4 w-4 text-primary" />
            Live link
          </div>
          <p className="text-xs text-text-secondary">
            Always shows current catalog prices. No login required.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={liveUrl} className="font-mono text-xs" />
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={copied === "live" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={() => void copyText(liveUrl, "live")}
              >
                {copied === "live" ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => window.open(liveUrl, "_blank", "noopener,noreferrer")}
              >
                Open
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border-light bg-surface-hover/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Download className="h-4 w-4 text-primary" />
            Download PDF
          </div>
          <p className="text-xs text-text-secondary">{config.pdfHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void handleDownloadPdf()}>
              Download PDF
            </Button>
            {pdfUrl ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={copied === "pdf" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={() => void copyText(pdfUrl, "pdf")}
              >
                {copied === "pdf" ? "Link copied" : "Copy storage link"}
              </Button>
            ) : null}
            {htmlUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => window.open(htmlUrl, "_blank", "noopener,noreferrer")}
              >
                Open HTML snapshot
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border-light bg-surface-hover/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Mail className="h-4 w-4 text-primary" />
            Send via email
          </div>
          <p className="text-xs text-text-secondary">
            Sends the rate card with PDF attached plus links to the live page and storage PDF.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-text-secondary" htmlFor={`${idPrefix}-email-to`}>
                Recipient email *
              </label>
              <Input
                id={`${idPrefix}-email-to`}
                type="email"
                placeholder={config.emailPlaceholder}
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor={`${idPrefix}-email-name`}>
                Name (optional)
              </label>
              <Input
                id={`${idPrefix}-email-name`}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Sarah"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-text-secondary" htmlFor={`${idPrefix}-email-msg`}>
                Message (optional)
              </label>
              <textarea
                id={`${idPrefix}-email-msg`}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a note for the recipient…"
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>
          </div>
          {sendError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{sendError}</p>
          ) : null}
          {sendOk ? (
            <p className="text-sm font-medium text-fx-green">Rate card sent successfully.</p>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={sending || !emailTo.trim()}
            icon={sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            onClick={() => void handleSendEmail()}
          >
            {sending ? "Sending…" : "Send email"}
          </Button>
        </section>
      </div>
    </Modal>
  );
}
