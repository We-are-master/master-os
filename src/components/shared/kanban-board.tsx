"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Plus, MoreHorizontal } from "lucide-react";

export interface KanbanColumn<T> {
  id: string;
  title: string;
  color: string;
  items: T[];
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => React.ReactNode;
  getCardId: (item: T) => string;
  onCardClick?: (item: T) => void;
  className?: string;
}

export function KanbanBoard<T>({
  columns,
  renderCard,
  getCardId,
  onCardClick,
  className,
}: KanbanBoardProps<T>) {
  return (
    <div className={cn("flex gap-4 overflow-x-auto pb-4", className)}>
      {columns.map((column) => (
        <div key={column.id} className="flex-shrink-0 w-72">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full", column.color)} />
              <h3 className="text-sm font-semibold text-text-primary">{column.title}</h3>
              <span className="text-[10px] font-bold text-text-tertiary bg-stone-100 px-1.5 py-0.5 rounded-md">
                {column.items.length}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button className="h-6 w-6 rounded-md flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button className="h-6 w-6 rounded-md flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            {column.items.map((item) => (
              <motion.div
                key={getCardId(item)}
                variants={staggerItem}
                onClick={() => onCardClick?.(item)}
                className={onCardClick ? "cursor-pointer" : ""}
              >
                {renderCard(item)}
              </motion.div>
            ))}
          </motion.div>
        </div>
      ))}
    </div>
  );
}
