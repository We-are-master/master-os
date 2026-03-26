import { getSupabase } from "./base";
import type { AuditLog, AuditAction, AuditEntityType } from "@/types/database";

interface LogParams {
  entityType: AuditEntityType;
  entityId: string;
  entityRef?: string;
  action: AuditAction;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  userId?: string;
  userName?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(params: LogParams): Promise<void> {
  const supabase = getSupabase();
  try {
    await supabase.from("audit_logs").insert({
      entity_type: params.entityType,
      entity_id: params.entityId,
      entity_ref: params.entityRef,
      action: params.action,
      field_name: params.fieldName,
      old_value: params.oldValue,
      new_value: params.newValue,
      user_id: params.userId,
      user_name: params.userName,
      metadata: params.metadata ?? {},
    });
  } catch {
    console.error("Failed to write audit log");
  }
}

export async function logFieldChanges(
  entityType: AuditEntityType,
  entityId: string,
  entityRef: string | undefined,
  oldRecord: Record<string, unknown>,
  newFields: Record<string, unknown>,
  userId?: string,
  userName?: string,
): Promise<void> {
  const entries = Object.entries(newFields).filter(
    ([key, val]) => val !== undefined && String(oldRecord[key] ?? "") !== String(val),
  );
  if (entries.length === 0) return;

  const supabase = getSupabase();
  const logs = entries.map(([key, val]) => ({
    entity_type: entityType,
    entity_id: entityId,
    entity_ref: entityRef,
    action: key === "status" ? "status_changed" as const : "updated" as const,
    field_name: key,
    old_value: oldRecord[key] != null ? String(oldRecord[key]) : null,
    new_value: val != null ? String(val) : null,
    user_id: userId,
    user_name: userName,
    metadata: {},
  }));

  try {
    await supabase.from("audit_logs").insert(logs);
  } catch {
    console.error("Failed to write audit logs");
  }
}

export async function logBulkAction(
  entityType: AuditEntityType,
  entityIds: string[],
  action: AuditAction,
  fieldName: string,
  newValue: string,
  userId?: string,
  userName?: string,
): Promise<void> {
  const supabase = getSupabase();
  const logs = entityIds.map((id) => ({
    entity_type: entityType,
    entity_id: id,
    action: "bulk_update" as const,
    field_name: fieldName,
    new_value: newValue,
    user_id: userId,
    user_name: userName,
    metadata: { bulk_count: entityIds.length },
  }));

  try {
    await supabase.from("audit_logs").insert(logs);
  } catch {
    console.error("Failed to write bulk audit logs");
  }
}

export async function getAuditLogs(
  entityType: AuditEntityType,
  entityId: string,
  limit = 100,
): Promise<AuditLog[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AuditLog[];
}

export async function getEntityFullHistory(entityId: string, limit = 100): Promise<AuditLog[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AuditLog[];
}
