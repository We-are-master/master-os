"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import Link from "next/link";
import {
  Plus,
  FileText,
  Users,
  Briefcase,
  Receipt,
  Calendar,
  UserPlus,
  ArrowRight,
} from "lucide-react";

const actions = [
  { label: "New Request", icon: Plus, href: "/requests", color: "bg-primary/5 text-primary hover:bg-primary/10" },
  { label: "Create Quote", icon: FileText, href: "/quotes", color: "bg-blue-50 text-blue-600 hover:bg-blue-100" },
  { label: "Add Job", icon: Briefcase, href: "/jobs", color: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" },
  { label: "New Invoice", icon: Receipt, href: "/finance/invoices", color: "bg-amber-50 text-amber-600 hover:bg-amber-100" },
  { label: "Schedule Job", icon: Calendar, href: "/schedule", color: "bg-purple-50 text-purple-600 hover:bg-purple-100" },
  { label: "Invite Partner", icon: UserPlus, href: "/partners", color: "bg-teal-50 text-teal-600 hover:bg-teal-100" },
];

export function QuickActions() {
  return (
    <Card padding="none">
      <CardHeader className="px-5 pt-5">
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-2 px-3 pb-3"
      >
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <motion.div key={action.label} variants={staggerItem}>
              <Link href={action.href}>
                <motion.div
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors cursor-pointer ${action.color}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{action.label}</span>
                </motion.div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </Card>
  );
}
