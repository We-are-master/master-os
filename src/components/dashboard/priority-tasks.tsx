"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { getSupabase } from "@/services/base";
import Link from "next/link";

interface PriorityTask {
  id: string;
  title: string;
  module: string;
  href: string;
  priority: "urgent" | "high" | "medium";
  deadline: string;
  assignee?: string;
}

const priorityConfig = {
  urgent: { color: "danger" as const, icon: AlertTriangle },
  high: { color: "warning" as const, icon: Clock },
  medium: { color: "info" as const, icon: Clock },
};

export function PriorityTasks() {
  const [tasks, setTasks] = useState<PriorityTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const [urgentReqs, overdueInv, pendingJobs, draftQuotes] = await Promise.all([
          supabase.from("service_requests")
            .select("id, reference, priority, owner_name")
            .in("priority", ["urgent", "high"])
            .in("status", ["new", "in_review"])
            .order("created_at", { ascending: false })
            .limit(3),
          supabase.from("invoices")
            .select("id, reference, client_name, amount")
            .eq("status", "overdue")
            .order("due_date", { ascending: true })
            .limit(3),
          supabase.from("jobs")
            .select("id, reference, title, owner_name")
            .eq("status", "pending_schedule")
            .order("created_at", { ascending: false })
            .limit(2),
          supabase.from("quotes")
            .select("id, reference, title, owner_name")
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(2),
        ]);

        const items: PriorityTask[] = [];

        for (const req of (urgentReqs.data ?? []) as { id: string; reference: string; priority: string; owner_name?: string }[]) {
          items.push({
            id: req.id,
            title: `Review ${req.priority} request ${req.reference}`,
            module: "Requests",
            href: "/requests",
            priority: req.priority === "urgent" ? "urgent" : "high",
            deadline: req.priority === "urgent" ? "Urgent" : "Today",
            assignee: req.owner_name,
          });
        }

        for (const inv of (overdueInv.data ?? []) as { id: string; reference: string; client_name: string; amount: number }[]) {
          items.push({
            id: inv.id,
            title: `Collect overdue ${inv.reference} — ${inv.client_name}`,
            module: "Finance",
            href: "/finance/invoices",
            priority: "high",
            deadline: "Overdue",
            assignee: undefined,
          });
        }

        for (const job of (pendingJobs.data ?? []) as { id: string; reference: string; title: string; owner_name?: string }[]) {
          items.push({
            id: job.id,
            title: `Schedule ${job.reference} — ${job.title}`,
            module: "Jobs",
            href: "/jobs",
            priority: "medium",
            deadline: "This week",
            assignee: job.owner_name,
          });
        }

        for (const qt of (draftQuotes.data ?? []) as { id: string; reference: string; title: string; owner_name?: string }[]) {
          items.push({
            id: qt.id,
            title: `Complete draft quote ${qt.reference}`,
            module: "Quotes",
            href: "/quotes",
            priority: "medium",
            deadline: "This week",
            assignee: qt.owner_name,
          });
        }

        setTasks(items.slice(0, 6));
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const urgentCount = tasks.filter((t) => t.priority === "urgent").length;

  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Priority Actions</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {loading ? "Loading..." : `${tasks.length} items need attention`}
          </p>
        </div>
        {urgentCount > 0 && (
          <Badge variant="warning" dot pulse>
            {urgentCount} urgent
          </Badge>
        )}
      </CardHeader>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="px-2 pb-3"
      >
        {loading && (
          <div className="space-y-2 px-3 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse h-14 bg-surface-hover rounded-lg" />
            ))}
          </div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-text-tertiary">No priority actions right now</p>
          </div>
        )}
        {!loading && tasks.map((task) => {
          const config = priorityConfig[task.priority];
          return (
            <motion.div key={task.id} variants={staggerItem}>
              <Link href={task.href}>
                <motion.div
                  whileHover={{ x: 2 }}
                  className="group flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface-hover/60 cursor-pointer transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={config.color} size="sm" dot>
                        {task.deadline}
                      </Badge>
                      <span className="text-[11px] text-text-tertiary">{task.module}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.assignee && <Avatar name={task.assignee} size="xs" />}
                    <ArrowRight className="h-4 w-4 text-stone-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>
                </motion.div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </Card>
  );
}
