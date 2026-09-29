import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantId } from "@/lib/tenant";
import { errorMessage } from "./errors";

export type AuditAction =
  | "client_linked"
  | "client_created_invoice123"
  | "clients_imported"
  | "invoice_created"
  | "invoice_creation_failed"
  | "invoice_reconciled"
  | "invoices_imported"
  | "payment_created"
  | "payment_failed"
  | "pdf_generated"
  | "purchase_sent"
  | "purchase_linked"
  | "purchase_send_failed"
  | "invoice_deleted_remote"
  | "purchase_deleted_remote";

/**
 * Best-effort financial audit trail. Never throws (an audit write must not
 * turn a successful invoice into a reported failure) and never stores tokens
 * or personal codes — only ids, statuses and sanitized messages.
 */
export async function audit(
  tenantId: TenantId,
  entry: {
    action: AuditAction;
    result: "ok" | "error";
    entityType?: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await createAdminClient().from("invoice123_audit_log").insert({
      user_id: tenantId,
      actor_id: tenantId,
      action: entry.action,
      result: entry.result,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error(JSON.stringify({ scope: "invoice123-audit", tenant: tenantId, action: entry.action, error: errorMessage(err) }));
  }
}
