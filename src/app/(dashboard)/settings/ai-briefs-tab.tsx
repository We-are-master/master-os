"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Loader2, Sparkles, Mail, Clock, Globe, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { getSupabase } from "@/services/base";

const TIMEZONES = [
  "Europe/London",
  "Europe/Lisbon",
  "UTC",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Australia/Sydney",
];

export function AiBriefsTab() {
  const { canEditConfig } = useAdminConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<{ openaiConfigured: boolean; model: string } | null>(null);

  const [form, setForm] = useState({
    master_brain_enabled: false,
    master_brain_manager_enabled: false,
    master_brain_operator_enabled: false,
    master_brain_manager_instructions: "",
    master_brain_operator_instructions: "",
    daily_brief_enabled: false,
    daily_brief_morning_time: "08:00",
    daily_brief_evening_time: "18:00",
    daily_brief_timezone: "Europe/London",
    daily_brief_emails: "",
  });

  const update = (field: string, value: string | boolean) => setForm((p) => ({ ...p, [field]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.from("company_settings").select("*").limit(1).single();
      if (cancelled) return;
      if (data) {
        setSettingsId(data.id);
        const r = data as Record<string, unknown>;
        setForm({
          master_brain_enabled: Boolean(r.master_brain_enabled),
          master_brain_manager_enabled: Boolean(r.master_brain_manager_enabled),
          master_brain_operator_enabled: Boolean(r.master_brain_operator_enabled),
          master_brain_manager_instructions: String(r.master_brain_manager_instructions ?? ""),
          master_brain_operator_instructions: String(r.master_brain_operator_instructions ?? ""),
          daily_brief_enabled: Boolean(r.daily_brief_enabled),
          daily_brief_morning_time: String(r.daily_brief_morning_time ?? "08:00"),
          daily_brief_evening_time: String(r.daily_brief_evening_time ?? "18:00"),
          daily_brief_timezone: String(r.daily_brief_timezone ?? "Europe/London"),
          daily_brief_emails: String(r.daily_brief_emails ?? ""),
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/chat");
        if (res.ok) {
          const j = await res.json();
          setApiStatus({ openaiConfigured: j.openaiConfigured, model: j.model });
        }
      } catch {
        setApiStatus(null);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!canEditConfig || !settingsId) {
      toast.error("Cannot save");
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("company_settings")
        .update({
          master_brain_enabled: form.master_brain_enabled,
          master_brain_manager_enabled: form.master_brain_manager_enabled,
          master_brain_operator_enabled: form.master_brain_operator_enabled,
          master_brain_manager_instructions: form.master_brain_manager_instructions.trim(),
          master_brain_operator_instructions: form.master_brain_operator_instructions.trim(),
          daily_brief_enabled: form.daily_brief_enabled,
          daily_brief_morning_time: form.daily_brief_morning_time,
          daily_brief_evening_time: form.daily_brief_evening_time,
          daily_brief_timezone: form.daily_brief_timezone,
          daily_brief_emails: form.daily_brief_emails.trim(),
        })
        .eq("id", settingsId);
      if (error) throw error;
      toast.success("AI & brief settings saved");
      window.dispatchEvent(new Event("master-os-company-settings"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          AI &amp; Daily brief
        </h3>
        <p className="text-sm text-text-tertiary mt-1">
          Master Brain uses OpenAI on the server (<strong>never</strong> put API keys in the browser). Daily briefs are sent by a secured cron endpoint.
        </p>
      </div>

      <div className="rounded-xl border border-border-light bg-surface-hover/50 px-4 py-3 text-xs text-text-secondary space-y-1">
        <p>
          <strong>OpenAI:</strong>{" "}
          {apiStatus?.openaiConfigured ? (
            <span className="text-emerald-600">Configured · model {apiStatus.model}</span>
          ) : (
            <span className="text-amber-600">Not set — add OPENAI_API_KEY (and optional OPENAI_MODEL) to Vercel / server env.</span>
          )}
        </p>
        <p>
          <strong>Cron:</strong> set <code className="bg-card px-1 rounded">CRON_SECRET</code> in env and call{" "}
          <code className="bg-card px-1 rounded">GET /api/cron/daily-brief</code> with{" "}
          <code className="bg-card px-1 rounded">Authorization: Bearer …</code> every 15 minutes (see{" "}
          <code className="bg-card px-1 rounded">docs/MASTER_BRAIN.md</code>).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Admin</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={form.master_brain_enabled}
                disabled={!canEditConfig}
                onChange={(e) => update("master_brain_enabled", e.target.checked)}
              />
              Enable Master Brain for <strong>Admin</strong>
            </label>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Company-wide view: jobs, quotes, requests, invoices and the audit trail.
            </p>
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Manager</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={form.master_brain_manager_enabled}
                disabled={!canEditConfig}
                onChange={(e) => update("master_brain_manager_enabled", e.target.checked)}
              />
              Enable Master Brain for <strong>Manager</strong>
            </label>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Focus on the quotes pipeline, margins and follow-up. Uses the same operational summary plus quote-level detail.
            </p>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Extra instructions (optional)</label>
              <textarea
                rows={4}
                value={form.master_brain_manager_instructions}
                onChange={(e) => update("master_brain_manager_instructions", e.target.value)}
                disabled={!canEditConfig}
                placeholder="E.g. Prioritise B2B accounts; always mention a 48-hour response SLA…"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-y min-h-[88px] focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Operator</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={form.master_brain_operator_enabled}
                disabled={!canEditConfig}
                onChange={(e) => update("master_brain_operator_enabled", e.target.checked)}
              />
              Enable Master Brain for <strong>Operator</strong>
            </label>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Day-to-day in the field: jobs where the user is <code className="text-[10px]">owner</code>, plus quotes context.
            </p>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Extra instructions (optional)</label>
              <textarea
                rows={4}
                value={form.master_brain_operator_instructions}
                onChange={(e) => update("master_brain_operator_instructions", e.target.value)}
                disabled={!canEditConfig}
                placeholder="E.g. Remind about PPE; keep answers brief; use British English…"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-y min-h-[88px] focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Daily email brief</CardTitle>
            </div>
          </CardHeader>
          <div className="p-6 space-y-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={form.daily_brief_enabled}
                disabled={!canEditConfig}
                onChange={(e) => update("daily_brief_enabled", e.target.checked)}
              />
              Send morning &amp; end-of-day reports
            </label>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Recipient emails (comma-separated)</label>
              <Input
                value={form.daily_brief_emails}
                onChange={(e) => update("daily_brief_emails", e.target.value)}
                placeholder="ops@company.com, admin@company.com"
                disabled={!canEditConfig}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-text-secondary mb-1.5">
                  <Clock className="h-3 w-3" /> Morning (HH:mm)
                </label>
                <Input
                  type="time"
                  value={form.daily_brief_morning_time}
                  onChange={(e) => update("daily_brief_morning_time", e.target.value)}
                  disabled={!canEditConfig}
                />
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-text-secondary mb-1.5">
                  <Clock className="h-3 w-3" /> Evening (HH:mm)
                </label>
                <Input
                  type="time"
                  value={form.daily_brief_evening_time}
                  onChange={(e) => update("daily_brief_evening_time", e.target.value)}
                  disabled={!canEditConfig}
                />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-text-secondary mb-1.5">
                <Globe className="h-3 w-3" /> Timezone
              </label>
              <Select
                value={form.daily_brief_timezone}
                onChange={(e) => update("daily_brief_timezone", e.target.value)}
                disabled={!canEditConfig}
                options={TIMEZONES.map((z) => ({ value: z, label: z }))}
              />
            </div>
            <p className="text-[11px] text-text-tertiary">
              Times apply in the selected timezone. Cron should run at least every 15 minutes. Each slot sends at most once per calendar day.
              Requires <strong>RESEND_API_KEY</strong> and <strong>RESEND_FROM_EMAIL</strong> (same as quote e-mails).
            </p>
          </div>
        </Card>
      </div>

      <Button onClick={handleSave} disabled={!canEditConfig || saving || !settingsId} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>
        {saving ? "Saving…" : "Save AI & brief settings"}
      </Button>
    </div>
  );
}
