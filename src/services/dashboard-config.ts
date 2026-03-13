import { getSupabase } from "@/services/base";
import type { DashboardView, WidgetConfig } from "@/types/dashboard-config";
import type { RoleKey } from "@/types/admin-config";

function parseView(row: Record<string, unknown>): DashboardView {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    icon: (row.icon as string) ?? "LayoutDashboard",
    is_default: (row.is_default as boolean) ?? false,
    sort_order: (row.sort_order as number) ?? 0,
    permissions: Array.isArray(row.permissions) ? (row.permissions as RoleKey[]) : JSON.parse(row.permissions as string),
    widgets: Array.isArray(row.widgets) ? (row.widgets as WidgetConfig[]) : JSON.parse(row.widgets as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getDashboardViews(): Promise<DashboardView[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("dashboard_views")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(parseView);
}

export async function saveDashboardView(view: Omit<DashboardView, "created_at" | "updated_at">): Promise<DashboardView> {
  const supabase = getSupabase();
  const payload = {
    id: view.id,
    name: view.name,
    description: view.description ?? null,
    icon: view.icon,
    is_default: view.is_default,
    sort_order: view.sort_order,
    permissions: view.permissions,
    widgets: view.widgets,
    updated_at: new Date().toISOString(),
  };

  // upsert by id — if id looks like a uuid that exists, update; otherwise insert (new)
  const { data, error } = await supabase
    .from("dashboard_views")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return parseView(data as Record<string, unknown>);
}

export async function deleteDashboardView(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("dashboard_views").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setDefaultView(id: string): Promise<void> {
  const supabase = getSupabase();
  // unset all, then set this one
  await supabase.from("dashboard_views").update({ is_default: false }).neq("id", id);
  const { error } = await supabase.from("dashboard_views").update({ is_default: true }).eq("id", id);
  if (error) throw new Error(error.message);
}
