"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { X, Plus, Trash2, GripVertical, Save, Loader2, Star, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useDashboardConfig } from "@/hooks/use-dashboard-config";
import type { DashboardView, WidgetConfig, WidgetSize } from "@/types/dashboard-config";
import { WIDGET_CATALOG, CUSTOM_WIDGET_CATALOG } from "@/types/dashboard-config";
import type { RoleKey } from "@/types/admin-config";
import { CustomWidgetBuilder } from "./custom-widget-builder";
const uuidv4 = () => crypto.randomUUID();

const ICON_OPTIONS = ["LayoutDashboard", "DollarSign", "Briefcase", "BarChart2", "PieChart", "Activity", "Users", "Settings"];
const ROLE_OPTIONS: { key: RoleKey; label: string; color: string }[] = [
  { key: "admin",    label: "Admin",    color: "bg-red-50 text-red-700 border-red-200" },
  { key: "manager",  label: "Manager",  color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "operator", label: "Operator", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];

const SIZE_LABELS: Record<WidgetSize, string> = {
  one_third:  "1/3",
  half:       "1/2",
  two_thirds: "2/3",
  full:       "Full",
};

interface Props {
  open: boolean;
  onClose: () => void;
  editView?: DashboardView | null;
}

export function DashboardViewEditor({ open, onClose, editView }: Props) {
  const { saveView, deleteView, makeDefault } = useDashboardConfig();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"info" | "widgets">("info");
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);

  const [form, setForm] = useState<{
    id: string;
    name: string;
    description: string;
    icon: string;
    is_default: boolean;
    sort_order: number;
    permissions: RoleKey[];
    widgets: WidgetConfig[];
  }>({
    id: "",
    name: "",
    description: "",
    icon: "LayoutDashboard",
    is_default: false,
    sort_order: 99,
    permissions: ["admin", "manager", "operator"],
    widgets: [],
  });

  useEffect(() => {
    if (editView) {
      setForm({
        id: editView.id,
        name: editView.name,
        description: editView.description ?? "",
        icon: editView.icon,
        is_default: editView.is_default,
        sort_order: editView.sort_order,
        permissions: [...editView.permissions],
        widgets: editView.widgets.map((w) => ({ ...w })),
      });
    } else {
      setForm({
        id: uuidv4(),
        name: "",
        description: "",
        icon: "LayoutDashboard",
        is_default: false,
        sort_order: 99,
        permissions: ["admin", "manager", "operator"],
        widgets: [],
      });
    }
    setTab("info");
  }, [editView, open]);

  const toggleRole = (role: RoleKey) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(role)
        ? prev.permissions.filter((r) => r !== role)
        : [...prev.permissions, role],
    }));
  };

  const addWidget = (type: (typeof WIDGET_CATALOG)[0]) => {
    const widget: WidgetConfig = {
      id: uuidv4(),
      type: type.type,
      title: type.label,
      size: type.defaultSize,
      position: form.widgets.length,
    };
    setForm((prev) => ({ ...prev, widgets: [...prev.widgets, widget] }));
  };

  const addCustomWidget = (widget: WidgetConfig) => {
    setForm((prev) => ({
      ...prev,
      widgets: [...prev.widgets, { ...widget, position: prev.widgets.length }],
    }));
  };

  const removeWidget = (id: string) => {
    setForm((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.id !== id).map((w, i) => ({ ...w, position: i })),
    }));
  };

  const changeWidgetSize = (id: string, size: WidgetSize) => {
    setForm((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => w.id === id ? { ...w, size } : w),
    }));
  };

  const moveWidget = (id: string, dir: -1 | 1) => {
    setForm((prev) => {
      const widgets = [...prev.widgets];
      const idx = widgets.findIndex((w) => w.id === id);
      const next = idx + dir;
      if (next < 0 || next >= widgets.length) return prev;
      [widgets[idx], widgets[next]] = [widgets[next], widgets[idx]];
      return { ...prev, widgets: widgets.map((w, i) => ({ ...w, position: i })) };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("A name is required."); return; }
    setSaving(true);
    try {
      await saveView(form);
      toast.success(`View "${form.name}" saved.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editView) return;
    setDeleting(true);
    try {
      await deleteView(editView.id);
      toast.success(`View "${editView.name}" deleted.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async () => {
    if (!editView) return;
    try {
      await makeDefault(editView.id);
      toast.success(`"${editView.name}" is now the default view.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  return (
    <>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="relative z-10 w-full max-w-2xl bg-card rounded-2xl shadow-2xl border border-card-border flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <div>
                <h2 className="text-base font-bold text-text-primary">
                  {editView ? `Edit view: ${editView.name}` : "New dashboard view"}
                </h2>
                <p className="text-xs text-text-tertiary mt-0.5">Only Admin can create and edit views</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                <X className="h-4 w-4 text-text-tertiary" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border-light px-6 pt-3 gap-4">
              {(["info", "widgets"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`pb-2.5 text-sm font-medium transition-colors border-b-2 ${
                    tab === t ? "text-primary border-primary" : "text-text-tertiary border-transparent hover:text-text-secondary"
                  }`}
                >
                  {t === "info" ? "Info & Permissions" : `Widgets (${form.widgets.length})`}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {tab === "info" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nome da View</label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Operations, Finance…"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-text-secondary mb-1.5">Ícone</label>
                      <select
                        value={form.icon}
                        onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary"
                      >
                        {ICON_OPTIONS.map((ico) => <option key={ico} value={ico}>{ico}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Brief description of what this view shows…"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none h-16"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-2">
                      <Shield className="h-3.5 w-3.5 inline mr-1" />
                      Quem pode ver esta view
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {ROLE_OPTIONS.map((role) => {
                        const active = form.permissions.includes(role.key);
                        return (
                          <button
                            key={role.key}
                            onClick={() => toggleRole(role.key)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              active ? role.color : "bg-surface-hover text-text-tertiary border-border"
                            }`}
                          >
                            {active && <Check className="h-3 w-3" />}
                            {role.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-text-tertiary mt-1.5">
                      Admin can always see all views regardless of this setting.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1.5">Display order</label>
                    <Input
                      type="number"
                      value={form.sort_order}
                      onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                      className="w-24"
                    />
                  </div>
                </>
              )}

              {tab === "widgets" && (
                <>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Active widgets</p>
                    {form.widgets.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-6 text-center">
                        <p className="text-sm text-text-tertiary">No widgets yet. Add one from the catalogue below.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {form.widgets.map((w, i) => (
                          <div key={w.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-hover/60 border border-border-light">
                            <GripVertical className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
                            <span className="text-xs font-semibold text-text-primary flex-1 truncate">{w.title}</span>
                            <select
                              value={w.size}
                              onChange={(e) => changeWidgetSize(w.id, e.target.value as WidgetSize)}
                              className="text-xs px-2 py-1 rounded-lg border border-border bg-card"
                            >
                              {(Object.entries(SIZE_LABELS) as [WidgetSize, string][]).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                            <button onClick={() => moveWidget(w.id, -1)} disabled={i === 0} className="p-1 rounded hover:bg-surface-tertiary disabled:opacity-30 text-text-tertiary">↑</button>
                            <button onClick={() => moveWidget(w.id, 1)} disabled={i === form.widgets.length - 1} className="p-1 rounded hover:bg-surface-tertiary disabled:opacity-30 text-text-tertiary">↓</button>
                            <button onClick={() => removeWidget(w.id)} className="p-1 rounded hover:bg-red-50 text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border-light">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Built-in widgets</p>
                    <div className="grid grid-cols-2 gap-2">
                      {WIDGET_CATALOG.map((w) => (
                        <button
                          key={w.type}
                          onClick={() => addWidget(w)}
                          className="text-left p-3 rounded-xl border border-border bg-card hover:bg-surface-hover hover:border-primary/30 transition-all group"
                        >
                          <div className="flex items-start gap-2">
                            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                              <Plus className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-text-primary group-hover:text-primary transition-colors">{w.label}</p>
                              <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{w.description}</p>
                              <span className="text-[10px] font-medium text-text-tertiary">{SIZE_LABELS[w.defaultSize]}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom widget builder */}
                  <div className="space-y-2 pt-2 border-t border-border-light">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Custom widgets</p>
                      <span className="text-[10px] bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">Admin only</span>
                    </div>
                    <p className="text-[11px] text-text-tertiary leading-relaxed">
                      Build your own widgets by connecting directly to any data source — no code required.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {CUSTOM_WIDGET_CATALOG.map((w) => (
                        <button
                          key={w.type}
                          onClick={() => setCustomBuilderOpen(true)}
                          className="text-left p-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/70 transition-all group"
                        >
                          <div className="flex flex-col items-start gap-1.5">
                            <div className="h-7 w-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                              <Plus className="h-3.5 w-3.5" />
                            </div>
                            <p className="text-xs font-semibold text-primary">{w.label}</p>
                            <p className="text-[10px] text-text-tertiary leading-relaxed">{w.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border-light bg-surface-hover/30 rounded-b-2xl">
              <div className="flex items-center gap-2">
                {editView && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSetDefault}
                      icon={<Star className="h-3.5 w-3.5" />}
                      disabled={editView.is_default}
                    >
                      {editView.is_default ? "Default" : "Set as default"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      disabled={deleting || editView.is_default}
                      icon={deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      className="text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                >
                  {saving ? "Saving…" : "Save view"}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    <CustomWidgetBuilder
      open={customBuilderOpen}
      onClose={() => setCustomBuilderOpen(false)}
      onAdd={addCustomWidget}
    />
    </>
  );
}
