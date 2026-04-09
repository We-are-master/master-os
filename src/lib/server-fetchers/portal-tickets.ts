import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalTicketRow {
  id:           string;
  reference:    string;
  subject:      string;
  type:         string;
  priority:     string;
  status:       string;
  job_id:       string | null;
  job_reference: string | null;
  created_at:   string;
  updated_at:   string;
  last_message_at: string | null;
}

export interface PortalTicketDetail {
  id:           string;
  reference:    string;
  subject:      string;
  type:         string;
  priority:     string;
  status:       string;
  created_at:   string;
  updated_at:   string;
  job:          {
    id:               string;
    reference:        string;
    title:            string;
    status:           string;
    scheduled_date:   string | null;
    partner_name:     string | null;
    current_phase:    number | null;
    total_phases:     number | null;
    property_address: string | null;
  } | null;
  messages: Array<{
    id:           string;
    sender_type:  string;
    sender_name:  string | null;
    body:         string;
    attachments:  unknown[];
    created_at:   string;
  }>;
}

/**
 * Returns all tickets for an account, ordered by most recent first.
 * Joins the most recent message's created_at for the "last message" column,
 * and the job reference when linked.
 */
export async function fetchAccountTickets(accountId: string): Promise<PortalTicketRow[]> {
  const supabase = await getServerSupabase();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id, reference, subject, type, priority, status, job_id, created_at, updated_at")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error || !tickets) return [];

  const rows = tickets as Array<{
    id: string; reference: string; subject: string; type: string;
    priority: string; status: string; job_id: string | null;
    created_at: string; updated_at: string;
  }>;

  // Batch-resolve job references and last message timestamps
  const ticketIds = rows.map((t) => t.id);
  const jobIds    = rows.map((t) => t.job_id).filter((id): id is string => id != null);

  const [jobsRes, msgsRes] = await Promise.all([
    jobIds.length > 0
      ? supabase
          .from("jobs")
          .select("id, reference")
          .in("id", jobIds)
          .limit(200)
      : Promise.resolve({ data: [] }),
    ticketIds.length > 0
      ? supabase
          .from("ticket_messages")
          .select("ticket_id, created_at")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [] }),
  ]);

  const jobRefMap = new Map<string, string>();
  for (const j of (jobsRes.data ?? []) as Array<{ id: string; reference: string }>) {
    jobRefMap.set(j.id, j.reference);
  }

  // For each ticket, take the latest message created_at
  const lastMsgMap = new Map<string, string>();
  for (const m of (msgsRes.data ?? []) as Array<{ ticket_id: string; created_at: string }>) {
    if (!lastMsgMap.has(m.ticket_id)) lastMsgMap.set(m.ticket_id, m.created_at);
  }

  return rows.map((t) => ({
    ...t,
    job_reference:   t.job_id ? (jobRefMap.get(t.job_id) ?? null) : null,
    last_message_at: lastMsgMap.get(t.id) ?? null,
  }));
}

/**
 * Loads a single ticket with all messages and optional job embed.
 * Returns null on cross-account access.
 */
export async function fetchPortalTicketDetail(
  ticketId: string,
  accountId: string,
): Promise<PortalTicketDetail | null> {
  const supabase = await getServerSupabase();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, reference, subject, type, priority, status, job_id, account_id, created_at, updated_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return null;
  const t = ticket as Record<string, unknown>;
  if (t.account_id !== accountId) return null;

  // Fetch messages + optional job in parallel
  const [{ data: messages }, jobResult] = await Promise.all([
    supabase
      .from("ticket_messages")
      .select("id, sender_type, sender_name, body, attachments, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(500),
    t.job_id
      ? supabase
          .from("jobs")
          .select("id, reference, title, status, scheduled_date, partner_name, current_phase, total_phases, property_address")
          .eq("id", t.job_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id:         t.id as string,
    reference:  (t.reference as string) ?? "",
    subject:    (t.subject as string) ?? "",
    type:       (t.type as string) ?? "general",
    priority:   (t.priority as string) ?? "medium",
    status:     (t.status as string) ?? "open",
    created_at: (t.created_at as string) ?? "",
    updated_at: (t.updated_at as string) ?? "",
    job:        jobResult.data
      ? (jobResult.data as PortalTicketDetail["job"])
      : null,
    messages:   (messages ?? []) as PortalTicketDetail["messages"],
  };
}
