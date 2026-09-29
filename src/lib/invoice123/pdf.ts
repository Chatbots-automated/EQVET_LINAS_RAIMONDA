import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant";
import { audit } from "./audit";
import { invoice123Binary } from "./client";
import { Invoice123Error } from "./errors";

const BUCKET = "invoice-pdfs";

/**
 * Returns an issued invoice's PDF. First fetch comes from Invoice123
 * (GET /invoice/{id}/pdf/{lang}) and is kept in the private "invoice-pdfs"
 * bucket under {user_id}/{invoice_id}.pdf, so GVET retains the issued
 * document even if Invoice123 is unavailable later. `refresh` re-fetches
 * (e.g. after a payment, if the template shows paid state).
 */
export async function getInvoicePdf(
  ctx: TenantContext,
  invoiceId: string,
  opts: { refresh?: boolean } = {}
): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const admin = createAdminClient();
  const { data: invoice, error } = await admin
    .from("sales_invoices").select("*").eq("id", invoiceId).eq("user_id", ctx.tenantId).maybeSingle();
  if (error) throw error;
  if (!invoice || invoice.status !== "created" || !invoice.invoice123_invoice_id) {
    throw new Invoice123Error({ code: "not_found", message: `No issued invoice ${invoiceId} for tenant`, userMessage: "Sąskaita nerasta." });
  }

  const filename = `${invoice.series_title ?? "saskaita"}${invoice.series_number ?? ""}.pdf`.replace(/[^\w.-]+/g, "_");
  const path = `${ctx.tenantId}/${invoice.id}.pdf`;

  if (invoice.pdf_storage_path && !opts.refresh) {
    const { data } = await admin.storage.from(BUCKET).download(invoice.pdf_storage_path);
    if (data) return { bytes: await data.arrayBuffer(), filename };
  }

  const { bytes, contentType } = await invoice123Binary(
    ctx.tenantId,
    `/invoice/${encodeURIComponent(invoice.invoice123_invoice_id)}/pdf/${encodeURIComponent(invoice.language || "lt")}`,
    { permission: "invoice:index", requireEnabled: false, op: "invoice-pdf" }
  );
  if (!contentType?.includes("pdf")) {
    throw new Invoice123Error({ code: "unexpected_response", message: `PDF endpoint returned ${contentType}` });
  }

  // Caching is best-effort: a storage hiccup must not block viewing the PDF.
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (!uploadError) {
    await admin.from("sales_invoices").update({ pdf_storage_path: path }).eq("id", invoice.id).eq("user_id", ctx.tenantId);
    if (!invoice.pdf_storage_path) {
      await audit(ctx.tenantId, { action: "pdf_generated", result: "ok", entityType: "sales_invoice", entityId: invoice.id });
    }
  } else {
    console.warn(JSON.stringify({ scope: "invoice123-pdf", tenant: ctx.tenantId, invoice: invoice.id, error: uploadError.message }));
  }
  return { bytes, filename };
}
