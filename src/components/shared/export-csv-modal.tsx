"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type ExportMode = "all" | "visible" | "custom";

export function ExportCsvModal({
  open,
  onClose,
  allFields,
  visibleFields,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  allFields: string[];
  visibleFields: string[];
  onConfirm: (fields: string[]) => Promise<void> | void;
}) {
  const dedupAll = useMemo(
    () => [...new Set(allFields.filter(Boolean))],
    [allFields],
  );
  const dedupVisible = useMemo(
    () => [...new Set(visibleFields.filter((f) => dedupAll.includes(f)))],
    [visibleFields, dedupAll],
  );
  const [mode, setMode] = useState<ExportMode>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set(dedupVisible));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("all");
    setSelected(new Set(dedupVisible));
    setSaving(false);
  }, [open, dedupVisible]);

  const toggle = (field: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const chosenFields =
    mode === "all"
      ? dedupAll
      : mode === "visible"
        ? dedupVisible
        : dedupAll.filter((f) => selected.has(f));

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Export CSV"
      subtitle="Choose what fields to include in the export file."
      size="md"
    >
      <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { id: "all", label: "Export all fields" },
            { id: "visible", label: "Export table columns" },
            { id: "custom", label: "Choose fields" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id as ExportMode)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors ${
                mode === opt.id
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border-light bg-card text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mode === "custom" ? (
          <div className="rounded-lg border border-border-light p-3 max-h-64 overflow-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {dedupAll.map((field) => (
                <label key={field} className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={selected.has(field)}
                    onChange={() => toggle(field)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="truncate" title={field}>{field}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-[11px] text-text-tertiary">
          {chosenFields.length} field{chosenFields.length === 1 ? "" : "s"} selected
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || chosenFields.length === 0}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm(chosenFields);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}

