"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { SearchInput } from "@/components/ui/input";
import { UserPlus, Filter, Users, Clock, CheckCircle2, MapPin, Mail, Phone, Calendar, ArrowRight, Briefcase } from "lucide-react";

interface Applicant {
  id: string;
  name: string;
  trade: string;
  location: string;
  date: string;
  progress?: number;
  status_detail?: string;
}

const columns: KanbanColumn<Applicant>[] = [
  {
    id: "new",
    title: "New Application",
    color: "bg-stone-400",
    items: [
      { id: "1", name: "Marcus Williams", trade: "Electrician", location: "Manhattan, NY", date: "Mar 7" },
      { id: "2", name: "Jennifer Lopez", trade: "HVAC", location: "Brooklyn, NY", date: "Mar 6" },
      { id: "3", name: "David Kim", trade: "Plumber", location: "Queens, NY", date: "Mar 5" },
      { id: "4", name: "Anna Petrova", trade: "Technician", location: "Bronx, NY", date: "Mar 5" },
    ],
  },
  {
    id: "docs",
    title: "Document Verification",
    color: "bg-amber-500",
    items: [
      { id: "5", name: "Robert Chen", trade: "Electrician", location: "Manhattan, NY", date: "Mar 4", status_detail: "License Pending" },
      { id: "6", name: "Sarah Martinez", trade: "HVAC", location: "Staten Island, NY", date: "Mar 3" },
    ],
  },
  {
    id: "background",
    title: "Background Check",
    color: "bg-indigo-500",
    items: [
      { id: "7", name: "James Thompson", trade: "Plumber", location: "Brooklyn, NY", date: "Mar 2" },
    ],
  },
  {
    id: "training",
    title: "Training & Induction",
    color: "bg-primary",
    items: [
      { id: "8", name: "Michelle Park", trade: "Technician", location: "Manhattan, NY", date: "Feb 28", progress: 65 },
      { id: "9", name: "Kevin Brown", trade: "Electrician", location: "Queens, NY", date: "Feb 25", progress: 85 },
      { id: "10", name: "Lisa Wang", trade: "HVAC", location: "Brooklyn, NY", date: "Feb 22", progress: 45 },
    ],
  },
  {
    id: "ready",
    title: "Ready to Onboard",
    color: "bg-emerald-500",
    items: [
      { id: "11", name: "Carlos Rivera", trade: "Plumber", location: "Manhattan, NY", date: "Feb 20" },
    ],
  },
];

const tradeColors: Record<string, string> = {
  Electrician: "bg-purple-50 text-purple-700",
  HVAC: "bg-blue-50 text-blue-700",
  Plumber: "bg-teal-50 text-teal-700",
  Technician: "bg-amber-50 text-amber-700",
};

function ApplicantCard({ item }: { item: Applicant }) {
  return (
    <Card hover padding="sm" className="group">
      <div className="flex items-start justify-between mb-2">
        <Badge size="sm" className={tradeColors[item.trade] || "bg-stone-100 text-stone-700"}>
          {item.trade}
        </Badge>
        <span className="text-[11px] text-text-tertiary">{item.date}</span>
      </div>
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar name={item.name} size="sm" />
        <p className="text-sm font-semibold text-text-primary">{item.name}</p>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
        <MapPin className="h-3 w-3" />
        {item.location}
      </div>
      {item.status_detail && (
        <Badge variant="warning" size="sm" className="mt-2">{item.status_detail}</Badge>
      )}
      {item.progress !== undefined && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-text-tertiary">Modules</span>
            <span className="text-[10px] font-semibold text-text-primary">{item.progress}%</span>
          </div>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${item.progress}%` }} />
          </div>
        </div>
      )}
    </Card>
  );
}

const PARTNER_STAGES = ["new", "docs", "background", "training", "ready"] as const;
const partnerStageConfig: Record<string, { title: string }> = {
  new: { title: "New Application" },
  docs: { title: "Document Verification" },
  background: { title: "Background Check" },
  training: { title: "Training & Induction" },
  ready: { title: "Ready to Onboard" },
};

export default function PartnerPipelinePage() {
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
  const [currentStage, setCurrentStage] = useState<string>("");

  const handleCardClick = (item: Applicant) => {
    const stage = columns.find((c) => c.items.some((i) => i.id === item.id))?.id ?? "";
    setCurrentStage(stage);
    setSelectedApplicant(item);
  };

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Partner Onboarding Pipeline" subtitle="Track partner applications through the onboarding process.">
          <Button variant="outline" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>Filter</Button>
          <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />}>Invite Partner</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Applicants" value={24} format="number" change={12} changeLabel="this month" icon={Users} accent="blue" />
          <KpiCard title="In Progress" value={11} format="number" description="Across all stages" icon={Clock} accent="amber" />
          <KpiCard title="Ready to Onboard" value={3} format="number" description="Activate now" icon={CheckCircle2} accent="emerald" />
          <KpiCard title="Avg. Time to Onboard" value="8 Days" change={-15} changeLabel="faster" icon={Clock} accent="primary" />
        </StaggerContainer>

        <div className="flex items-center gap-3 mb-2">
          <SearchInput placeholder="Search applicants..." className="w-64" />
        </div>

        <KanbanBoard
          columns={columns}
          renderCard={(item) => <ApplicantCard item={item} />}
          getCardId={(item) => item.id}
          onCardClick={handleCardClick}
        />
      </div>

      <Drawer open={!!selectedApplicant} onClose={() => setSelectedApplicant(null)} title={selectedApplicant?.name ?? ""} subtitle={selectedApplicant?.trade + " — " + selectedApplicant?.location} width="w-[500px]">
        {selectedApplicant && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-4">
              <Avatar name={selectedApplicant.name} size="xl" />
              <div>
                <h3 className="text-lg font-bold text-text-primary">{selectedApplicant.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge size="sm" className={tradeColors[selectedApplicant.trade] || "bg-stone-100 text-stone-700"}>{selectedApplicant.trade}</Badge>
                  <Badge variant="info" size="sm" dot>{partnerStageConfig[currentStage]?.title ?? currentStage}</Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-secondary"><MapPin className="h-4 w-4 text-text-tertiary" />{selectedApplicant.location}</div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Calendar className="h-4 w-4 text-text-tertiary" />Applied: {selectedApplicant.date}</div>
            </div>

            {selectedApplicant.status_detail && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-xs font-medium text-amber-700">{selectedApplicant.status_detail}</p>
              </div>
            )}

            {selectedApplicant.progress !== undefined && (
              <div className="p-4 rounded-xl bg-stone-50">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-tertiary uppercase">Training Progress</p>
                  <p className="text-sm font-bold text-text-primary">{selectedApplicant.progress}%</p>
                </div>
                <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${selectedApplicant.progress}%` }} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Pipeline Stage</p>
              {PARTNER_STAGES.map((s, idx) => {
                const stageIdx = PARTNER_STAGES.indexOf(currentStage as typeof PARTNER_STAGES[number]);
                const isCurrent = currentStage === s;
                const isPast = stageIdx > idx;
                return (
                  <div key={s} className={`flex items-center gap-3 p-2.5 rounded-xl ${
                    isCurrent ? "bg-primary/5 border border-primary/20" :
                    isPast ? "bg-emerald-50/50" : "bg-stone-50"
                  }`}>
                    <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                      isCurrent ? "bg-primary text-white" :
                      isPast ? "bg-emerald-500 text-white" :
                      "bg-stone-200 text-stone-500"
                    }`}>
                      {isPast ? <CheckCircle2 className="h-3 w-3" /> : idx + 1}
                    </div>
                    <p className={`text-sm font-medium ${isCurrent ? "text-primary" : isPast ? "text-emerald-700" : "text-text-secondary"}`}>
                      {partnerStageConfig[s].title}
                    </p>
                    {isCurrent && <Badge variant="primary" size="sm">Current</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Drawer>
    </PageTransition>
  );
}
