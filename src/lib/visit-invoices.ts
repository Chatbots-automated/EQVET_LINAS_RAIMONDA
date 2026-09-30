import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type VisitInvoice = Pick<
  Database["public"]["Tables"]["sales_invoices"]["Row"],
  "id" | "status" | "series_title" | "series_number" | "total" | "payment_status"
>;

const COLUMNS = "id, status, series_title, series_number, total, payment_status";

/**
 * visit id → the invoices that cover it. An invoice can cover several visits
 * (sales_invoice_visits), so this is the one place that answers "was this
 * visit invoiced?". Pass visitIds to limit the lookup to those visits.
 */
export async function loadInvoicesByVisit(
  supabase: SupabaseClient<Database>,
  visitIds?: string[]
): Promise<Map<string, VisitInvoice[]>> {
  const map = new Map<string, VisitInvoice[]>();
  if (visitIds && visitIds.length === 0) return map;

  let linkQuery = supabase.from("sales_invoice_visits").select("invoice_id, visit_id");
  if (visitIds) linkQuery = linkQuery.in("visit_id", visitIds);
  const { data: links } = await linkQuery;
  if (!links || links.length === 0) return map;

  const invoiceIds = [...new Set(links.map((l) => l.invoice_id))];
  const { data: invoices } = await supabase.from("sales_invoices").select(COLUMNS).in("id", invoiceIds);
  const byId = new Map((invoices ?? []).map((i) => [i.id, i]));

  for (const l of links) {
    const inv = byId.get(l.invoice_id);
    if (inv) map.set(l.visit_id, [...(map.get(l.visit_id) ?? []), inv]);
  }
  return map;
}

/** A visit counts as invoiced unless every invoice attempt for it definitely failed. */
export function isInvoiced(invoices: VisitInvoice[] | undefined) {
  return (invoices ?? []).some((i) => i.status !== "failed");
}
