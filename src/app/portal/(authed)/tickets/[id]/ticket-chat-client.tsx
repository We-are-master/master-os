"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Paperclip, X, Loader2, FileText as FileIcon } from "lucide-react";
import {
  uploadTicketAttachment,
  getTicketAttachmentUrl,
  type TicketAttachmentUpload,
} from "@/services/portal-ticket-attachments";

interface Message {
  id:          string;
  sender_type: string;
  sender_name: string | null;
  body:        string;
  attachments: unknown[];
  created_at:  string;
}

interface TicketChatClientProps {
  ticketId:      string;
  messages:      Message[];
  isOpen:        boolean;
  currentUserId: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function TicketChatClient({ ticketId, messages, isOpen }: TicketChatClientProps) {
  const router  = useRouter();
  const endRef  = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reply, setReply]       = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Pending attachments (uploaded to Storage, not yet sent with a message)
  const [pendingAttachments, setPendingAttachments] = useState<TicketAttachmentUpload[]>([]);

  // Optimistic messages — shown instantly before the server confirms.
  const [optimistic, setOptimistic] = useState<Message[]>([]);

  // Signed URL cache per attachment path (attachments store just the path)
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  const allMessages = [
    ...messages,
    ...optimistic.filter((o) => !messages.some((m) => m.id === o.id)),
  ];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  // Clear optimistic messages once server data catches up
  useEffect(() => {
    if (optimistic.length > 0) {
      const serverIds = new Set(messages.map((m) => m.id));
      setOptimistic((prev) => prev.filter((o) => !serverIds.has(o.id)));
    }
  }, [messages, optimistic.length]);

  // Resolve attachment paths → signed URLs (cached, deduped)
  useEffect(() => {
    const needed: string[] = [];
    for (const m of allMessages) {
      if (!Array.isArray(m.attachments)) continue;
      for (const a of m.attachments) {
        const p = (a as { path?: unknown })?.path;
        if (typeof p === "string" && !attachmentUrls[p]) needed.push(p);
      }
    }
    if (needed.length === 0) return;
    let cancelled = false;
    void Promise.all(
      needed.map(async (p) => {
        try { return [p, await getTicketAttachmentUrl(p)] as const; }
        catch { return null; }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      if (Object.keys(next).length > 0) setAttachmentUrls((prev) => ({ ...prev, ...next }));
    });
    return () => { cancelled = true; };
  }, [allMessages, attachmentUrls]);

  const handleFilePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    setUploading(true);
    setError(null);
    try {
      const uploads = await Promise.all(
        files.map((f) => uploadTicketAttachment(ticketId, f)),
      );
      setPendingAttachments((prev) => [...prev, ...uploads].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, [ticketId]);

  const removePending = (path: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = reply.trim();
    if (!text && pendingAttachments.length === 0) return;
    setError(null);
    const tempId = `optimistic-${Date.now()}`;
    const sentAttachments = pendingAttachments;

    const optimisticMsg: Message = {
      id:          tempId,
      sender_type: "portal_user",
      sender_name: "You",
      body:        text,
      attachments: sentAttachments,
      created_at:  new Date().toISOString(),
    };
    setOptimistic((prev) => [...prev, optimisticMsg]);
    setReply("");
    setPendingAttachments([]);

    setSending(true);
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ body: text, attachments: sentAttachments }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        setReply(text);
        setPendingAttachments(sentAttachments);
        setError(typeof json.error === "string" ? json.error : "Could not send your message.");
        setSending(false);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("[ticket-chat] send error:", err);
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setReply(text);
      setPendingAttachments(sentAttachments);
      setError("Could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {/* Messages thread */}
      <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
        {allMessages.length === 0 && (
          <p className="text-sm text-text-tertiary text-center py-8">No messages yet.</p>
        )}
        {allMessages.map((msg) => {
          const isMe = msg.sender_type === "portal_user";
          const attList = Array.isArray(msg.attachments) ? msg.attachments : [];
          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] ${isMe ? "order-2" : ""}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    isMe
                      ? "bg-orange-600 text-white rounded-br-md"
                      : "bg-surface-tertiary text-text-primary rounded-bl-md"
                  }`}
                >
                  {msg.body}
                  {attList.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {(attList as Array<{ path?: string; url?: string; name?: string; type?: string }>).map((att, idx) => {
                        const path = typeof att.path === "string" ? att.path : null;
                        // Legacy messages may carry `url` directly; new ones carry `path`.
                        const url = path ? attachmentUrls[path] : (att.url ?? null);
                        if (!url && !path) return null;
                        const isImage = (att.type ?? "").startsWith("image/");
                        if (isImage && url) {
                          return (
                            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={att.name ?? "attachment"}
                                loading="lazy"
                                decoding="async"
                                className="max-w-full max-h-48 rounded-lg border border-white/20"
                              />
                            </a>
                          );
                        }
                        return (
                          <a
                            key={idx}
                            href={url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                              isMe
                                ? "bg-white/20 text-white hover:bg-white/30"
                                : "bg-surface-hover text-text-primary hover:bg-surface-secondary"
                            } transition-colors`}
                          >
                            <FileIcon className="w-3.5 h-3.5" />
                            {att.name ?? "File"}
                            {!url && <span className="opacity-70">(loading...)</span>}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-2 mt-1 text-[10px] text-text-tertiary ${isMe ? "justify-end" : ""}`}>
                  <span>{msg.sender_name ?? (isMe ? "You" : "Master team")}</span>
                  <span>{fmtTime(msg.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {isOpen ? (
        <div className="px-6 py-4 border-t border-border-light">
          {error && (
            <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 rounded-xl px-4 py-2.5 text-sm">
              {error}
            </div>
          )}

          {/* Pending attachments preview */}
          {pendingAttachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingAttachments.map((a) => (
                <span
                  key={a.path}
                  className="inline-flex items-center gap-2 pl-2 pr-1 py-1 text-xs rounded-lg bg-surface-tertiary text-text-primary"
                >
                  <FileIcon className="w-3 h-3 text-text-tertiary" />
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removePending(a.path)}
                    className="h-5 w-5 rounded hover:bg-surface-hover text-text-tertiary inline-flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="flex items-end gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx,.txt"
              onChange={handleFilePick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || sending || pendingAttachments.length >= 6}
              className="p-3 rounded-xl bg-surface-secondary text-text-secondary hover:bg-surface-tertiary transition-colors shrink-0 disabled:opacity-50"
              title="Attach file"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            </button>
            <textarea
              className="flex-1 px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
              rows={2}
              placeholder="Type your reply..."
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(e); }
              }}
            />
            <button
              type="submit"
              disabled={sending || uploading || (!reply.trim() && pendingAttachments.length === 0)}
              className="p-3 rounded-xl bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className="px-6 py-4 border-t border-border-light bg-surface-secondary text-center">
          <p className="text-sm text-text-secondary">
            This ticket has been resolved. Reply to reopen it.
          </p>
          <form onSubmit={handleSend} className="mt-3 flex items-end gap-3">
            <textarea
              className="flex-1 px-4 py-3 rounded-xl border border-border bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
              rows={2}
              placeholder="Type to reopen..."
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="p-3 rounded-xl bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
