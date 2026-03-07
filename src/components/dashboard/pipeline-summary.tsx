"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatCurrency } from "@/lib/utils";
import { getSupabase } from "@/services/base";

interface PipelineStage {
  name: string;
  stage: string;
  count: number;
  value: number;
  color: string;
}

const STAGE_CONFIG: Record<string, { name: string; color: string }> = {
  lead: { name: "Lead", color: "bg-stone-400" },
  qualified: { name: "Qualified", color: "bg-blue-500" },
  meeting: { name: "Meeting", color: "bg-amber-500" },
  proposal: { name: "Proposal", color: "bg-purple-500" },
  negotiation: { name: "Negotiation", color: "bg-primary" },
  closed: { name: "Closed Won", color: "bg-emerald-500" },
};

export function PipelineSummary() {
  const [stages, setStages] = useState<PipelineStage[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const { data } = await supabase.from("pipeline_deals").select("stage, value");
      if (!data) return;

      const agg: Record<string, { count: number; value: number }> = {};
      for (const row of data) {
        if (!agg[row.stage]) agg[row.stage] = { count: 0, value: 0 };
        agg[row.stage].count += 1;
        agg[row.stage].value += Number(row.value);
      }

      const result: PipelineStage[] = Object.entries(STAGE_CONFIG).map(([key, cfg]) => ({
        name: cfg.name,
        stage: key,
        count: agg[key]?.count ?? 0,
        value: agg[key]?.value ?? 0,
        color: cfg.color,
      }));
      setStages(result);
    }
    load();
  }, []);

  const totalValue = stages.reduce((acc, s) => acc + s.value, 0);

  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>Sales Pipeline</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {formatCurrency(totalValue)} total value
          </p>
        </div>
        <button className="text-xs font-medium text-primary hover:text-primary-hover transition-colors">
          View pipeline
        </button>
      </CardHeader>

      {totalValue > 0 && (
        <div className="px-5 pb-2">
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
            {stages.map((stage) => (
              <motion.div
                key={stage.stage}
                initial={{ width: 0 }}
                animate={{ width: `${(stage.value / totalValue) * 100}%` }}
                transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.3 }}
                className={`${stage.color} rounded-full`}
              />
            ))}
          </div>
        </div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="px-2 pb-3"
      >
        {stages.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-text-tertiary">No pipeline data</p>
          </div>
        )}
        {stages.map((stage) => (
          <motion.div
            key={stage.stage}
            variants={staggerItem}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-stone-50/60 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className={`h-2 w-2 rounded-full ${stage.color}`} />
              <span className="text-sm text-text-primary font-medium">{stage.name}</span>
              <Badge size="sm">{stage.count}</Badge>
            </div>
            <span className="text-sm font-semibold text-text-primary">
              {formatCurrency(stage.value)}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </Card>
  );
}
