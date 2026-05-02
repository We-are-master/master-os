"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

type Turn = { role: "user" | "assistant"; content: string };

function buildContextBlock(
  forecastWeeks: { label: string; sold: number }[],
  rangeLabel: string
): string {
  const lines = forecastWeeks.map((w) => `- ${w.label}: ${formatCurrency(w.sold)}`).join("\n");
  return `Dashboard context (${rangeLabel}) — weekly pipeline sold (billable GBP by schedule-start week):\n${lines || "(no weeks in range)"}`;
}

export function DashboardForecastChat({
  forecastWeeks,
  rangeLabel,
}: {
  forecastWeeks: { label: string; sold: number }[];
  rangeLabel: string;
}) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    const ctx = buildContextBlock(forecastWeeks, rangeLabel);
    const message = `${ctx}\n\nUser question (answer using the weekly figures above; do not invent data): ${q}`;
    setInput("");
    const prior = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: prior }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "" }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            e instanceof Error
              ? e.message
              : "Forecast chat is unavailable. Enable Fixfy Brain for your role and ensure OPENAI_API_KEY is set.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, forecastWeeks, rangeLabel]);

  return (
    <div className="rounded-xl border border-border-light bg-surface-hover/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wide">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        Forecast assistant
      </div>
      <p className="text-[11px] text-text-tertiary leading-relaxed">
        Ask about trends in weekly sold pipeline. Uses the same weekly series as the chart above and Fixfy Brain (same rules as the AI button).
      </p>
      <div className="max-h-[200px] overflow-y-auto space-y-2 rounded-lg border border-border-light/60 bg-card/80 p-2 min-h-[72px]">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-text-tertiary px-1 py-2">Try: “Is the last 4 weeks trending up?”</p>
        )}
        {messages.map((t, i) => (
          <div
            key={i}
            className={`text-xs rounded-lg px-2.5 py-1.5 ${t.role === "user" ? "bg-primary/10 text-text-primary ml-4" : "bg-surface-hover text-text-secondary mr-4"}`}
          >
            {t.role === "assistant" ? (
              <div className="prose-brain prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{t.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{t.content}</p>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary px-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask about weekly pipeline…"
          className="flex-1 min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
        <Button type="button" size="sm" className="shrink-0 self-end" onClick={() => void send()} disabled={loading || !input.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
