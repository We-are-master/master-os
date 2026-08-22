"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";

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
  /**
   * Enables drag between columns. Receives the dragged item and the column it
   * was dropped on. Return nothing and handle the move yourself: a move that
   * needs a decision (a price, a reason, a confirmation) should open a modal
   * rather than save on the drop.
   */
  onCardDrop?: (item: T, toColumnId: string) => void;
  /** Ids currently mid-flight — those cards show as busy and can't be dragged. */
  pendingCardIds?: ReadonlySet<string>;
  /** Full-height columns that scroll their own cards, like the Live View board. */
  fillHeight?: boolean;
  className?: string;
}

const DRAG_MIME = "text/kanban-card-id";

export function KanbanBoard<T>({
  columns,
  renderCard,
  getCardId,
  onCardClick,
  onCardDrop,
  pendingCardIds,
  fillHeight = false,
  className,
}: KanbanBoardProps<T>) {
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const draggable = typeof onCardDrop === "function";

  const findItem = (id: string): { item: T; columnId: string } | null => {
    for (const column of columns) {
      for (const item of column.items) {
        if (getCardId(item) === id) return { item, columnId: column.id };
      }
    }
    return null;
  };

  return (
    <div
      className={cn(
        "flex gap-4 overflow-x-auto pb-4",
        fillHeight && "min-h-0 flex-1 lg:overflow-x-visible",
        className,
      )}
    >
      {columns.map((column) => {
        const isDropTarget = dragOverColumnId === column.id;
        return (
          <div
            key={column.id}
            onDragOver={(e) => {
              if (!draggable || !e.dataTransfer.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverColumnId !== column.id) setDragOverColumnId(column.id);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverColumnId((cur) => (cur === column.id ? null : cur));
            }}
            onDrop={(e) => {
              if (!draggable) return;
              e.preventDefault();
              setDragOverColumnId(null);
              const id = e.dataTransfer.getData(DRAG_MIME);
              const found = id ? findItem(id) : null;
              // Dropping a card back on its own column is not a move.
              if (!found || found.columnId === column.id) return;
              onCardDrop?.(found.item, column.id);
            }}
            className={cn(
              "w-72 flex-shrink-0 rounded-xl transition-colors",
              fillHeight && "flex min-h-0 flex-col lg:w-auto lg:min-w-0 lg:flex-1",
              isDropTarget && "bg-primary/5 ring-2 ring-primary/30",
            )}
          >
            <div className="mb-3 flex shrink-0 items-center gap-2 px-0.5">
              <div className={cn("h-2 w-2 rounded-full", column.color)} />
              <h3 className="text-sm font-semibold text-text-primary">{column.title}</h3>
              <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-bold text-text-tertiary">
                {column.items.length}
              </span>
            </div>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className={cn("space-y-2", fillHeight && "min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5")}
            >
              {column.items.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-text-tertiary">
                  {isDropTarget ? "Drop here" : "Nothing here."}
                </p>
              ) : (
                column.items.map((item) => {
                  const id = getCardId(item);
                  const pending = pendingCardIds?.has(id) ?? false;
                  return (
                    <motion.div
                      key={id}
                      variants={staggerItem}
                      draggable={draggable && !pending}
                      onDragStart={(e) => {
                        const dt = (e as unknown as React.DragEvent).dataTransfer;
                        if (!dt) return;
                        dt.effectAllowed = "move";
                        dt.setData(DRAG_MIME, id);
                      }}
                      onClick={() => {
                        if (!pending) onCardClick?.(item);
                      }}
                      className={cn(
                        pending && "pointer-events-none opacity-60",
                        onCardClick && !pending && "cursor-pointer",
                        draggable && !pending && "active:cursor-grabbing",
                      )}
                    >
                      {renderCard(item)}
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
