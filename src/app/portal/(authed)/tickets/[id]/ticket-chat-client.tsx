"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

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

export function TicketChatClient({ ticketId, messages, isOpen, currentUserId }: TicketChatClientProps) {
  const router  = useRouter();
  const endRef  = useRef<HTMLDivElement>(null);
  const [reply, setReply]       = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Optimistic messages — shown instantly before the server confirms.
  // Merged with server-provided messages, de-duped once the server data
  // refreshes and includes the new message.
  const [optimistic, setOptimistic] = useState<Message[]>([]);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setError(null);
    const text = reply.trim();
    const tempId = `optimistic-${Date.now()}`;

    // Optimistic: show the message immediately in the chat
    const optimisticMsg: Message = {
      id:          tempId,
      sender_type: "portal_user",
      sender_name: "You",
      body:        text,
      attachments: [],
      created_at:  new Date().toISOString(),
    };
    setOptimistic((prev) => [...prev, optimisticMsg]);
    setReply("");

    setSending(true);
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ body: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Remove the optimistic message on failure
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        setReply(text); // restore the text so the user can retry
        setError(typeof json.error === "string" ? json.error : "Could not send your message.");
        setSending(false);
        return;
      }
      // Background refresh to get the real message from the server
      // (which replaces the optimistic one via the de-dup logic above)
      router.refresh();
    } catch (err) {
      console.error("[ticket-chat] send error:", err);
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setReply(text);
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
                  {/* Attachments */}
                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {(msg.attachments as Array<{ url?: string; name?: string; type?: string }>).map((att, idx) => {
                        if (!att?.url) return null;
                        const isImage = (att.type ?? "").startsWith("image/");
                        if (isImage) {
                          return (
                            <a key={idx} href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={att.url}
                                alt={att.name ?? "attachment"}
                                className="max-w-full max-h-48 rounded-lg border border-white/20"
                              />
                            </a>
                          );
                        }
                        return (
                          <a
                            key={idx}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                              isMe
                                ? "bg-white/20 text-white hover:bg-white/30"
                                : "bg-surface-hover text-text-primary hover:bg-surface-secondary"
                            } transition-colors`}
                          >
                            📎 {att.name ?? "File"}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-2 mt-1 text-[10px] text-text-tertiary ${isMe ? "justify-end" : ""}`}>
                  <span>{msg.sender_name ?? (isMe ? "You" : "Fixfy team")}</span>
                  <span>{fmtTime(msg.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Reply form or closed banner */}
      {isOpen ? (
        <div className="px-6 py-4 border-t border-border-light">
          {error && (
            <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 rounded-xl px-4 py-2.5 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleSend} className="flex items-end gap-3">
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
              disabled={sending || !reply.trim()}
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
          <form
            onSubmit={handleSend}
            className="mt-3 flex items-end gap-3"
          >
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
