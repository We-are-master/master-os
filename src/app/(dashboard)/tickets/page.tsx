"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { SearchInput, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import {
  MessageSquare, Send, User, Calendar, MapPin, Briefcase,
  ChevronRight, ArrowRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import { useProfile } from "@/hooks/use-profile";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Ticket {
  id: string;
  reference: string;
  account_id: string;
  account_name?: string;
  subject: string;
  type: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  assigned_name?: string;
  job_id: string | null;
  job_reference?: string;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
}

interface TicketMessage {
  id: string;
  sender_type: string;
  sender_name: string | null;
  body: string;
  created_at: string;
}

interface JobEmbed {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduled_date: string | null;
  partner_name: string | null;
  property_address: string | null;
  current_phase: number | null;
  total_phases: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", awaiting_customer: "Awaiting customer",
  resolved: "Resolved", closed: "Closed",
};
const STATUS_VARIANT: Record<string, "info" | "warning" | "success" | "danger" | "default"> = {
  open: "info", in_progress: "warning", awaiting_customer: "warning",
  resolved: "success", closed: "default",
};
const PRIORITY_LABEL: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};
const TYPE_LABEL: Record<string, string> = {
  general: "General", billing: "Billing", job_related: "Job related", complaint: "Complaint",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TicketsPage() {
  const { profile } = useProfile();
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState("open");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<Ticket | null>(null);
  const [messages, setMessages]     = useState<TicketMessage[]>([]);
  const [jobEmbed, setJobEmbed]     = useState<JobEmbed | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // KPI counts
  const [counts, setCounts] = useState({ open: 0, in_progress: 0, awaiting: 0, resolved: 0 });

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("tickets")
        .select("id, reference, account_id, subject, type, priority, status, assigned_to, job_id, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);

      const rows = (data ?? []) as Ticket[];

      // Batch resolve account names
      const accountIds = [...new Set(rows.map((t) => t.account_id))];
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, company_name")
        .in("id", accountIds);
      const accountMap = new Map((accounts ?? []).map((a: { id: string; company_name: string }) => [a.id, a.company_name]));

      // Batch resolve assigned names
      const assignedIds = [...new Set(rows.map((t) => t.assigned_to).filter(Boolean))] as string[];
      const { data: profiles } = assignedIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", assignedIds)
        : { data: [] };
      const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

      // Batch resolve job references
      const jobIds = [...new Set(rows.map((t) => t.job_id).filter(Boolean))] as string[];
      const { data: jobs } = jobIds.length > 0
        ? await supabase.from("jobs").select("id, reference").in("id", jobIds)
        : { data: [] };
      const jobMap = new Map((jobs ?? []).map((j: { id: string; reference: string }) => [j.id, j.reference]));

      for (const t of rows) {
        t.account_name  = accountMap.get(t.account_id) ?? "—";
        t.assigned_name = t.assigned_to ? (profileMap.get(t.assigned_to) ?? "—") : undefined;
        t.job_reference = t.job_id ? (jobMap.get(t.job_id) ?? undefined) : undefined;
      }

      setTickets(rows);
      setCounts({
        open:        rows.filter((t) => t.status === "open").length,
        in_progress: rows.filter((t) => t.status === "in_progress").length,
        awaiting:    rows.filter((t) => t.status === "awaiting_customer").length,
        resolved:    rows.filter((t) => t.status === "resolved" || t.status === "closed").length,
      });
    } catch {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  const loadDetail = useCallback(async (ticket: Ticket) => {
    setSelected(ticket);
    setLoadingDetail(true);
    setMessages([]);
    setJobEmbed(null);
    try {
      const supabase = getSupabase();
      const [{ data: msgs }, jobRes] = await Promise.all([
        supabase
          .from("ticket_messages")
          .select("id, sender_type, sender_name, body, created_at")
          .eq("ticket_id", ticket.id)
          .order("created_at", { ascending: true })
          .limit(500),
        ticket.job_id
          ? supabase
              .from("jobs")
              .select("id, reference, title, status, scheduled_date, partner_name, property_address, current_phase, total_phases")
              .eq("id", ticket.job_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setMessages((msgs ?? []) as TicketMessage[]);
      setJobEmbed(jobRes.data as JobEmbed | null);
    } catch {
      toast.error("Failed to load ticket details");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Filter tickets
  const filtered = tickets.filter((t) => {
    if (tab === "open" && (t.status === "resolved" || t.status === "closed")) return false;
    if (tab === "resolved" && t.status !== "resolved" && t.status !== "closed") return false;
    if (tab === "mine" && t.assigned_to !== profile?.id) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.reference.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.account_name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Tickets" subtitle="Support tickets from account portal users" />

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile label="Open" value={counts.open} color="text-blue-600" />
          <KpiTile label="In progress" value={counts.in_progress} color="text-amber-600" />
          <KpiTile label="Awaiting customer" value={counts.awaiting} color="text-orange-600" />
          <KpiTile label="Resolved" value={counts.resolved} color="text-emerald-600" />
        </div>

        {/* Tabs + search */}
        <div className="flex items-center gap-3 flex-wrap">
          <Tabs
            variant="pills"
            activeTab={tab}
            onChange={setTab}
            tabs={[
              { id: "open",     label: "Open",     count: counts.open + counts.in_progress + counts.awaiting },
              { id: "mine",     label: "Mine",     count: tickets.filter((t) => t.assigned_to === profile?.id && t.status !== "resolved" && t.status !== "closed").length },
              { id: "resolved", label: "Resolved", count: counts.resolved },
              { id: "all",      label: "All" },
            ]}
          />
          <div className="ml-auto w-64">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets..." />
          </div>
        </div>

        {/* Tickets table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-text-tertiary">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading tickets...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <MessageSquare className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
              <p className="text-sm text-text-secondary">No tickets found</p>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void loadDetail(t)}
                  className={`w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-surface-hover transition-colors ${
                    selected?.id === t.id ? "bg-surface-hover" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono text-text-tertiary">{t.reference}</span>
                      <Badge variant={STATUS_VARIANT[t.status] ?? "default"} size="sm">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      <span className="text-xs text-text-tertiary">{TYPE_LABEL[t.type] ?? t.type}</span>
                      {t.priority === "high" || t.priority === "urgent" ? (
                        <Badge variant="danger" size="sm">{PRIORITY_LABEL[t.priority]}</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold text-text-primary truncate">{t.subject}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {t.account_name}
                      {t.assigned_name && <> &middot; {t.assigned_name}</>}
                      {t.job_reference && <> &middot; {t.job_reference}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-text-tertiary">{timeAgo(t.updated_at)}</span>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <TicketDrawer
            ticket={selected}
            messages={messages}
            jobEmbed={jobEmbed}
            loading={loadingDetail}
            currentUserId={profile?.id ?? ""}
            currentUserName={profile?.full_name ?? profile?.email ?? "Staff"}
            onClose={() => setSelected(null)}
            onRefresh={async () => {
              await loadTickets();
              await loadDetail(selected);
            }}
          />
        )}
      </Drawer>
    </PageTransition>
  );
}

// ─── KPI tile ────────────────────────────────────────────────────────────────

function KpiTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-black ${color} tabular-nums mt-1`}>{value}</p>
    </div>
  );
}

// ─── Ticket drawer ───────────────────────────────────────────────────────────

interface TicketDrawerProps {
  ticket: Ticket;
  messages: TicketMessage[];
  jobEmbed: JobEmbed | null;
  loading: boolean;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

function TicketDrawer({
  ticket, messages, jobEmbed, loading, currentUserId, currentUserName, onClose, onRefresh,
}: TicketDrawerProps) {
  const [reply, setReply]       = useState("");
  const [sending, setSending]   = useState(false);
  const [status, setStatus]     = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [saving, setSaving]     = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Optimistic messages for instant WhatsApp-style UX
  const [optimistic, setOptimistic] = useState<TicketMessage[]>([]);
  const allMessages = [
    ...messages,
    ...optimistic.filter((o) => !messages.some((m) => m.id === o.id)),
  ];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages.length]);

  // Clear optimistic once server data catches up
  useEffect(() => {
    if (optimistic.length > 0) {
      const serverIds = new Set(messages.map((m) => m.id));
      setOptimistic((prev) => prev.filter((o) => !serverIds.has(o.id)));
    }
  }, [messages, optimistic.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    const text = reply.trim();
    const tempId = `optimistic-${Date.now()}`;

    // Show immediately
    setOptimistic((prev) => [...prev, {
      id: tempId,
      sender_type: "staff",
      sender_name: currentUserName,
      body: text,
      created_at: new Date().toISOString(),
    }]);
    setReply("");

    setSending(true);
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        setReply(text);
        toast.error(typeof json.error === "string" ? json.error : "Failed to send reply");
        return;
      }
      // Background refresh to sync real data
      void onRefresh();
    } catch {
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setReply(text);
      toast.error("Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    setSaving(true);
    try {
      await fetch(`/api/admin/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(`Status updated to ${STATUS_LABEL[newStatus] ?? newStatus}`);
      await onRefresh();
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handlePriorityChange(newPriority: string) {
    setPriority(newPriority);
    setSaving(true);
    try {
      await fetch(`/api/admin/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      toast.success("Priority updated");
      await onRefresh();
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignToMe() {
    setSaving(true);
    try {
      await fetch(`/api/admin/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: currentUserId, status: "in_progress" }),
      });
      toast.success("Assigned to you");
      await onRefresh();
    } catch {
      toast.error("Failed to assign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs font-mono text-text-tertiary">{ticket.reference}</span>
          <Badge variant={STATUS_VARIANT[ticket.status] ?? "default"} size="sm">
            {STATUS_LABEL[ticket.status] ?? ticket.status}
          </Badge>
          <span className="text-xs text-text-tertiary">{TYPE_LABEL[ticket.type] ?? ticket.type}</span>
        </div>
        <h2 className="text-lg font-bold text-text-primary">{ticket.subject}</h2>
        <p className="text-xs text-text-tertiary mt-1">
          {ticket.account_name}
          {ticket.assigned_name && <> &middot; Assigned to {ticket.assigned_name}</>}
        </p>
      </div>

      {/* Controls */}
      <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <Select
          options={[
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "awaiting_customer", label: "Awaiting customer" },
            { value: "resolved", label: "Resolved" },
            { value: "closed", label: "Closed" },
          ]}
          value={status}
          onChange={(e) => void handleStatusChange(e.target.value)}
          disabled={saving}
        />
        <Select
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]}
          value={priority}
          onChange={(e) => void handlePriorityChange(e.target.value)}
          disabled={saving}
        />
        {!ticket.assigned_to && (
          <button
            type="button"
            onClick={handleAssignToMe}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-60"
          >
            Assign to me
          </button>
        )}
      </div>

      {/* Job embed */}
      {jobEmbed && (
        <div className="px-5 py-3 border-b border-border bg-surface-secondary">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Related job</p>
          <div className="flex items-center gap-3">
            <Briefcase className="w-4 h-4 text-text-tertiary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary truncate">
                {jobEmbed.reference} — {jobEmbed.title}
              </p>
              <p className="text-xs text-text-tertiary">
                {jobEmbed.status.replace(/_/g, " ")}
                {jobEmbed.partner_name && <> &middot; {jobEmbed.partner_name}</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : allMessages.length === 0 ? (
          <p className="text-sm text-text-tertiary text-center py-8">No messages.</p>
        ) : (
          allMessages.map((msg) => {
            const isStaff = msg.sender_type === "staff";
            return (
              <div key={msg.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[80%]">
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    isStaff
                      ? "bg-primary text-white rounded-br-md"
                      : "bg-surface-tertiary text-text-primary rounded-bl-md"
                  }`}>
                    {msg.body}
                  </div>
                  <div className={`flex items-center gap-2 mt-1 text-[10px] text-text-tertiary ${isStaff ? "justify-end" : ""}`}>
                    <span>{msg.sender_name ?? (isStaff ? "Staff" : "Customer")}</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Reply form */}
      <div className="px-5 py-4 border-t border-border">
        <form onSubmit={handleSend} className="flex items-end gap-3">
          <textarea
            className="flex-1 px-4 py-3 rounded-xl border border-border bg-surface-secondary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
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
            className="p-3 rounded-xl bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
