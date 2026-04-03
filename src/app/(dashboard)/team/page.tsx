"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Users, Shield, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Profile } from "@/types/database";
import { getSupabase } from "@/services/base";

const APP_ROLE_LABELS: Record<Profile["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
};

function profileIsActive(p: Pick<Profile, "is_active">): boolean {
  return p.is_active !== false;
}

/**
 * App sign-ins (profiles). Internal employees, contractors, and squads live under **People**.
 */
export default function TeamPage() {
  const [appUsers, setAppUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: profs, error: pErr } = await getSupabase()
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at, updated_at")
        .order("full_name", { ascending: true });
      if (pErr) {
        setAppUsers([]);
        toast.error(pErr.message || "Could not load app users");
      } else {
        setAppUsers((profs ?? []) as Profile[]);
      }
    } catch {
      toast.error("Failed to load team data");
      setAppUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Team Members"
          subtitle="People who can sign in to Master OS. Roster, squads, and payroll lines are managed in People — one profile per person."
        >
          <Link href="/people">
            <Button size="sm" icon={<Users className="h-4 w-4" />}>
              People directory
            </Button>
          </Link>
        </PageHeader>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <Card padding="md" className="space-y-4">
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <Shield className="h-4 w-4" /> App users
                </h3>
                <Link
                  href="/settings"
                  className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  Settings <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <p className="text-xs text-text-tertiary mb-3">
                Invite or change app roles in <strong className="text-text-secondary">Settings → Team Members</strong>.
                For squads, internal employees, and contractors, use{" "}
                <Link href="/people" className="font-semibold text-primary hover:underline">
                  People
                </Link>
                .
              </p>
              {loading ? (
                <div className="flex items-center justify-center py-6 text-text-tertiary">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <ul className="space-y-2">
                  {appUsers.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface-hover flex-wrap gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary">{u.full_name}</p>
                        <p className="text-xs text-text-tertiary truncate">{u.email}</p>
                        <p className="text-[11px] text-text-tertiary mt-0.5">
                          App: {APP_ROLE_LABELS[u.role] ?? u.role}
                        </p>
                      </div>
                      <Badge variant={profileIsActive(u) ? "success" : "default"} size="sm">
                        {profileIsActive(u) ? "Active" : "Inactive"}
                      </Badge>
                    </li>
                  ))}
                  {appUsers.length === 0 && (
                    <p className="text-sm text-text-tertiary py-3">No app users found. Check profiles access or invite from Settings.</p>
                  )}
                </ul>
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </PageTransition>
  );
}
