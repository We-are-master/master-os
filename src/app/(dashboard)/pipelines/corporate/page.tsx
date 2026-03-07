"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Tabs } from "@/components/ui/tabs";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { SearchInput } from "@/components/ui/input";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";
import {
  Plus, Filter, DollarSign, TrendingUp, Clock, MoreHorizontal,
  Building2, User, Calendar, Briefcase,
  ArrowRight, CheckCircle2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { PipelineDeal } from "@/types/database";
import { getSupabase } from "@/services/base";

const STAGES = ["lead", "qualified", "meeting", "proposal", "negotiation", "closed"] as const;

const stageConfig: Record<string, { title: string; color: string }> = {
  lead: { title: "Lead", color: "bg-stone-400" },
  qualified: { title: "Qualified", color: "bg-blue-500" },
  meeting: { title: "Meeting Scheduled", color: "bg-amber-500" },
  proposal: { title: "Proposal Sent", color: "bg-purple-500" },
  negotiation: { title: "Negotiation", color: "bg-primary" },
  closed: { title: "Contract Signed", color: "bg-emerald-500" },
};

const categoryColors: Record<string, string> = {
  Software: "bg-primary/10 text-primary",
  Logistics: "bg-blue-50 text-blue-700",
  Enterprise: "bg-emerald-50 text-emerald-700",
  Fintech: "bg-indigo-50 text-indigo-700",
  Retail: "bg-amber-50 text-amber-700",
  Healthcare: "bg-teal-50 text-teal-700",
};

export default function CorporatePipelinePage() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState<PipelineDeal | null>(null);
  const [search, setSearch] = useState("");

  const loadDeals = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase.from("pipeline_deals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setDeals((data ?? []) as PipelineDeal[]);
    } catch { toast.error("Failed to load deals"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  const filtered = useMemo(() => {
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter((d) => d.account_name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.owner_name.toLowerCase().includes(q));
  }, [deals, search]);

  const columns: KanbanColumn<PipelineDeal>[] = useMemo(() =>
    STAGES.map((stage) => ({
      id: stage,
      title: stageConfig[stage].title,
      color: stageConfig[stage].color,
      items: filtered.filter((d) => d.stage === stage),
    })),
    [filtered],
  );

  const totalPipelineValue = deals.reduce((s, d) => s + Number(d.value), 0);
  const dealsInNegotiation = deals.filter((d) => d.stage === "negotiation" || d.stage === "proposal").length;
  const closedValue = deals.filter((d) => d.stage === "closed").reduce((s, d) => s + Number(d.value), 0);

  const handleStageChange = async (deal: PipelineDeal, newStage: string) => {
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from("pipeline_deals").update({ stage: newStage }).eq("id", deal.id);
      if (error) throw error;
      toast.success(`Moved to ${stageConfig[newStage]?.title ?? newStage}`);
      setSelectedDeal({ ...deal, stage: newStage as PipelineDeal["stage"] });
      loadDeals();
    } catch { toast.error("Failed to update deal"); }
  };

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="B2B Sales Pipeline" subtitle="Corporate client acquisition and deal management.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>New Account Lead</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Total Pipeline" value={totalPipelineValue} format="currency" icon={DollarSign} accent="primary" />
          <KpiCard title="Closed Won" value={closedValue} format="currency" icon={TrendingUp} accent="emerald" />
          <KpiCard title="In Negotiation" value={dealsInNegotiation} format="number" description="deals in late stages" icon={Clock} accent="blue" />
        </StaggerContainer>

        <div className="flex items-center gap-3 mb-2">
          <SearchInput placeholder="Search deals..." className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-72 shrink-0 space-y-2">
                <div className="animate-pulse h-5 w-24 bg-stone-100 rounded" />
                <div className="animate-pulse h-36 bg-stone-50 rounded-xl" />
                <div className="animate-pulse h-36 bg-stone-50 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <KanbanBoard
            columns={columns}
            renderCard={(item) => <DealCard item={item} />}
            getCardId={(item) => item.id}
            onCardClick={(item) => setSelectedDeal(item)}
          />
        )}
      </div>

      <DealDetailDrawer
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onStageChange={handleStageChange}
      />
    </PageTransition>
  );
}

function DealCard({ item }: { item: PipelineDeal }) {
  return (
    <Card hover padding="sm" className="group">
      <div className="flex items-center justify-between mb-2">
        <Badge size="sm" className={categoryColors[item.category] || "bg-stone-100 text-stone-700"}>
          {item.category}
        </Badge>
        <button className="h-5 w-5 rounded flex items-center justify-center text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-stone-600">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-sm font-semibold text-text-primary mb-1">{item.account_name}</p>
      <p className="text-lg font-bold text-text-primary mb-2">{formatCurrency(item.value)}</p>
      <div className="flex items-center gap-3 text-[11px] text-text-tertiary mb-3">
        {item.monthly_volume && <span>Vol: {formatCurrency(item.monthly_volume)}/mo</span>}
        {item.properties && <span>{item.properties} properties</span>}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-stone-100">
        <div className="flex items-center gap-1.5">
          <Avatar name={item.owner_name} size="xs" />
          <span className="text-[11px] text-text-tertiary">{item.owner_name}</span>
        </div>
        <span className="text-[10px] text-text-tertiary">{item.last_activity}</span>
      </div>
    </Card>
  );
}

function DealDetailDrawer({
  deal,
  onClose,
  onStageChange,
}: {
  deal: PipelineDeal | null;
  onClose: () => void;
  onStageChange: (deal: PipelineDeal, stage: string) => void;
}) {
  const [tab, setTab] = useState("details");
  const [relatedAccounts, setRelatedAccounts] = useState<Array<{ id: string; company_name: string; status: string; total_revenue: number }>>([]);

  useEffect(() => {
    if (!deal) return;
    setTab("details");
    const supabase = getSupabase();
    supabase.from("accounts").select("id, company_name, status, total_revenue")
      .ilike("company_name", `%${deal.account_name.split(" ")[0]}%`)
      .limit(3)
      .then(({ data }) => setRelatedAccounts((data ?? []) as Array<{ id: string; company_name: string; status: string; total_revenue: number }>), () => {});
  }, [deal]);

  if (!deal) return <Drawer open={false} onClose={onClose}><div /></Drawer>;

  const stage = stageConfig[deal.stage] ?? { title: deal.stage, color: "bg-stone-400" };
  const stageIndex = STAGES.indexOf(deal.stage as typeof STAGES[number]);
  const nextStage = stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
  const prevStage = stageIndex > 0 ? STAGES[stageIndex - 1] : null;

  const drawerTabs = [
    { id: "details", label: "Details" },
    { id: "pipeline", label: "Pipeline" },
  ];

  return (
    <Drawer open={!!deal} onClose={onClose} title={deal.account_name} subtitle={deal.category + " — " + formatCurrency(deal.value)} width="w-[540px]">
      <div className="px-6 pt-3 pb-0 border-b border-stone-100">
        <Tabs tabs={drawerTabs} activeTab={tab} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "details" && (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-stone-100 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-stone-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-text-primary">{deal.account_name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge size="sm" className={categoryColors[deal.category] || "bg-stone-100 text-stone-700"}>{deal.category}</Badge>
                  <Badge variant="info" size="sm" dot>{stage.title}</Badge>
                </div>
              </div>
            </div>

            {/* Value Card */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">Deal Value</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatCurrency(deal.value)}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-text-tertiary">
                {deal.monthly_volume && <span>Monthly: {formatCurrency(deal.monthly_volume)}</span>}
                {deal.properties && <span>{deal.properties} properties</span>}
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-stone-50">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-text-tertiary" />
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase">Owner</p>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Avatar name={deal.owner_name} size="sm" />
                  <p className="text-sm font-medium text-text-primary">{deal.owner_name}</p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-stone-50">
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-text-tertiary" />
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase">Created</p>
                </div>
                <p className="text-sm font-medium text-text-primary mt-2">{formatDate(deal.created_at)}</p>
              </div>
              <div className="p-3 rounded-xl bg-stone-50">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-text-tertiary" />
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase">Last Activity</p>
                </div>
                <p className="text-sm font-medium text-text-primary mt-2">{deal.last_activity}</p>
              </div>
              {deal.properties && (
                <div className="p-3 rounded-xl bg-stone-50">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 text-text-tertiary" />
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase">Properties</p>
                  </div>
                  <p className="text-sm font-medium text-text-primary mt-2">{deal.properties}</p>
                </div>
              )}
            </div>

            {/* Related Accounts */}
            {relatedAccounts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Related Accounts</p>
                {relatedAccounts.map((acc) => (
                  <motion.div key={acc.id} variants={staggerItem} className="p-3 rounded-xl border border-stone-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-stone-400" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">{acc.company_name}</p>
                        <p className="text-[10px] text-text-tertiary capitalize">{acc.status}</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-text-primary">{formatCurrency(acc.total_revenue)}</p>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Stage Actions */}
            <div className="flex gap-2 pt-4 border-t border-stone-100">
              {nextStage && (
                <Button size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} className="flex-1" onClick={() => onStageChange(deal, nextStage)}>
                  Move to {stageConfig[nextStage].title}
                </Button>
              )}
              {prevStage && (
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onStageChange(deal, prevStage)}>
                  Back to {stageConfig[prevStage].title}
                </Button>
              )}
              {deal.stage !== "closed" && (
                <Button variant="outline" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => onStageChange(deal, "closed")}>
                  Won
                </Button>
              )}
            </div>
          </div>
        )}

        {tab === "pipeline" && (
          <div className="p-6 space-y-5">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Pipeline Progress</p>
            <div className="space-y-1">
              {STAGES.map((s, idx) => {
                const sConf = stageConfig[s];
                const isCurrent = deal.stage === s;
                const isPast = stageIndex > idx;
                return (
                  <button
                    key={s}
                    onClick={() => onStageChange(deal, s)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                      isCurrent ? "bg-primary/5 border border-primary/20 ring-1 ring-primary/10" :
                      isPast ? "bg-emerald-50/50 border border-emerald-100" :
                      "bg-stone-50 border border-transparent hover:border-stone-200"
                    }`}
                  >
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                      isCurrent ? "bg-primary text-white" :
                      isPast ? "bg-emerald-500 text-white" :
                      "bg-stone-200 text-stone-500"
                    }`}>
                      {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`text-sm font-medium ${isCurrent ? "text-primary" : isPast ? "text-emerald-700" : "text-text-secondary"}`}>
                        {sConf.title}
                      </p>
                    </div>
                    {isCurrent && <Badge variant="primary" size="sm">Current</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
