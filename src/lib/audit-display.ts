import type { AuditLog } from "@/types/database";

const entityLabels: Record<string, string> = {
  request: "Request",
  quote: "Quote",
  job: "Job",
  partner: "Partner",
  invoice: "Invoice",
  account: "Account",
  self_bill: "Self Bill",
  system: "System",
};

/** Human-readable title for an audit row (shared by activity feed + notifications). */
export function buildAuditTitle(log: AuditLog): string {
  const entity = entityLabels[log.entity_type] ?? log.entity_type;
  const ref = log.entity_ref ? ` ${log.entity_ref}` : "";

  switch (log.action) {
    case "created":
      return `New ${entity}${ref} created`;
    case "status_changed":
      return `${entity}${ref} → ${log.new_value ?? "updated"}`;
    case "phase_advanced":
      return `${entity}${ref} phase advanced`;
    case "assigned":
      return `${entity}${ref} assigned`;
    case "note":
      return `Note on ${entity}${ref}`;
    case "document_added":
      return `Document added to ${entity}${ref}`;
    case "payment":
      return `Payment on ${entity}${ref}`;
    case "bulk_update":
      return `Bulk update on ${entity}s`;
    default:
      return `${entity}${ref} ${log.action}`;
  }
}

export function buildAuditDescription(log: AuditLog): string {
  if (log.action === "status_changed" && log.field_name === "status") {
    return `${log.old_value ?? "—"} → ${log.new_value ?? "—"}`;
  }
  if (log.field_name && log.old_value && log.new_value) {
    return `${log.field_name}: ${log.old_value} → ${log.new_value}`;
  }
  if (log.action === "created") {
    return `${entityLabels[log.entity_type] ?? log.entity_type} record initialized`;
  }
  if (log.action === "bulk_update") {
    const count = (log.metadata as Record<string, unknown>)?.count;
    return count ? `${count} records updated` : "Multiple records updated";
  }
  return log.entity_ref ?? "";
}

/** Deep link for dashboard navigation from an audit log row. */
export function auditLogHref(log: AuditLog): string | null {
  switch (log.entity_type) {
    case "job":
      return `/jobs/${log.entity_id}`;
    case "quote":
      return "/quotes";
    case "request":
      return "/requests";
    case "invoice":
      return "/finance/invoices";
    case "partner":
      return "/partners";
    case "account":
      return "/accounts";
    case "self_bill":
      return "/finance/selfbill";
    default:
      return null;
  }
}
