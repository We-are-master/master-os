"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, X, User, Bot } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

type Turn = { role: "user" | "assistant"; content: string };
type BrainMode = "admin" | "manager" | "operator";

const QUICK_PROMPTS: Record<BrainMode, { label: string; text: string }[]> = {
  admin: [
    { label: "Today’s jobs", text: "How are we doing on jobs today? What should we prioritise?" },
    { label: "Quotes & pipeline", text: "Summarise the quotes pipeline and what needs action." },
    { label: "Cash & invoices", text: "What stands out on outstanding invoices and collections?" },
  ],
  manager: [
    { label: "Quote tips", text: "Give practical tips to move quotes in awaiting_customer and bidding forward (do not invent data)." },
    { label: "Today’s priorities", text: "What should I prioritise today across sales pipeline and quotes?" },
    { label: "Client follow-up", text: "Suggest a follow-up plan for stalled quotes based on the data." },
  ],
  operator: [
    { label: "My day", text: "Help me plan the day based on my assigned jobs." },
    { label: "Assigned jobs", text: "Summarise my open jobs and next steps on site." },
    { label: "Site checklist", text: "Short checklist before I go to a job (generic, do not invent addresses)." },
  ],
};

const MODE_LABEL: Record<BrainMode, string> = {
  admin: "Admin · company-wide",
  manager: "Manager · quotes & pipeline",
  operator: "Operator · day-to-day & jobs",
};

function MessageBubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
          isUser
            ? "border-primary/30 bg-primary/15 text-primary"
            : "border-border bg-surface-hover text-violet-500 dark:text-violet-400",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[min(100%,22rem)] rounded-2xl px-3.5 py-2.5 shadow-sm border",
          isUser
            ? "bg-primary/[0.12] border-primary/20 text-text-primary rounded-tr-md"
            : "bg-card border-border-light text-text-primary rounded-tl-md",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{turn.content}</p>
        ) : (
          <div className="text-[13px] leading-relaxed prose-brain">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                ul: ({ children }) => <ul className="mb-2 space-y-0.5 pl-4 last:mb-0">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 space-y-0.5 pl-4 list-decimal last:mb-0">{children}</ol>,
                li: ({ children }) => <li className="list-disc marker:text-text-tertiary">{children}</li>,
                h1: ({ children }) => <p className="font-bold text-text-primary mb-1">{children}</p>,
                h2: ({ children }) => <p className="font-semibold text-text-primary mb-1">{children}</p>,
                h3: ({ children }) => <p className="font-medium text-text-primary mb-1">{children}</p>,
                code: ({ children }) => <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[11px]">{children}</code>,
                hr: () => <hr className="my-2 border-border-light" />,
              }}
            >
              {turn.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function MasterBrainAssistant() {
  const { profile } = useProfile();
  const [mode, setMode] = useState<BrainMode | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadAccess = useCallback(async () => {
    if (!profile?.role) {
      setMode(null);
      return;
    }
    const { data } = await getSupabase()
      .from("company_settings")
      .select(
        "master_brain_enabled, master_brain_manager_enabled, master_brain_operator_enabled",
      )
      .limit(1)
      .maybeSingle();

    const r = data as {
      master_brain_enabled?: boolean;
      master_brain_manager_enabled?: boolean;
      master_brain_operator_enabled?: boolean;
    } | null;

    if (profile.role === "admin" && r?.master_brain_enabled) setMode("admin");
    else if (profile.role === "manager" && r?.master_brain_manager_enabled) setMode("manager");
    else if (profile.role === "operator" && r?.master_brain_operator_enabled) setMode("operator");
    else setMode(null);
  }, [profile?.role]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    const onEvt = () => void loadAccess();
    window.addEventListener("master-os-company-settings", onEvt);
    return () => window.removeEventListener("master-os-company-settings", onEvt);
  }, [loadAccess]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  const sendMessage = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || loading) return;
      setInput("");
      setError(null);
      const prior = messages;
      setMessages((m) => [...m, { role: "user", content: text }]);
      setLoading(true);
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history: prior,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
        setMessages(prior);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages],
  );

  const applyQuick = (text: string) => {
    setInput(text);
    void sendMessage(text);
  };

  // Listen for the header button to open the drawer
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("master-brain-open", handler);
    return () => window.removeEventListener("master-brain-open", handler);
  }, []);

  if (!mode) return null;

  const quick = QUICK_PROMPTS[mode];

  const footer = (
    <div className="px-4 pt-3 pb-4 space-y-3 bg-surface-secondary/40 dark:bg-surface/80">
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => applyQuick(q.text)}
            disabled={loading}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-primary/40 hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {q.label}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendMessage();
          }
        }}
        placeholder="Type your question… (Shift+Enter for a new line)"
        rows={3}
        className="w-full rounded-xl border border-primary/25 bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/35 focus:border-primary/40"
      />
      <div className="flex justify-between gap-2 items-center">
        <Button type="button" variant="outline" size="sm" onClick={() => setMessages([])} disabled={loading}>
          Clear chat
        </Button>
        <Button
          type="button"
          size="sm"
          icon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          onClick={() => void sendMessage()}
          disabled={loading || !input.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Master Brain"
        subtitle={MODE_LABEL[mode]}
        width="w-[min(100vw-0.5rem,480px)]"
        footer={footer}
      >
        <div className="flex flex-col min-h-[min(52vh,420px)] px-4 py-4 gap-3">
          {messages.length === 0 && !loading && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-hover/60 px-4 py-3 text-xs text-text-secondary leading-relaxed">
              <p className="font-medium text-text-primary mb-1">How to use</p>
              <p>
                Use the shortcuts below or type freely. Replies use real Master OS data (metrics and, for Manager/Operator, a focus on{" "}
                <strong>quotes</strong> and <strong>your jobs</strong> when you are the owner).
              </p>
              <p className="mt-2 text-text-tertiary">
                The OpenAI API runs on the server only — never share passwords here.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((m, i) => (
              <MessageBubble key={i} turn={m} />
            ))}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-text-tertiary text-xs pl-10">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>Thinking…</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2.5 text-xs text-red-700 dark:text-red-200 flex justify-between gap-2 items-start">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="shrink-0 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div ref={bottomRef} className="h-2 shrink-0" />
        </div>
      </Drawer>
    </>
  );
}
