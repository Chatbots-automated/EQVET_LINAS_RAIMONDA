import "server-only";
import type { Database } from "@/lib/database.types";
import { centsToNumber, centsToString, toCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant";
import { audit } from "./audit";
import { invoice123Request } from "./client";
import { errorMessage, Invoice123Error } from "./errors";
import { recomputePaymentState } from "./invoices";
import type { Invoice123PaymentCreatePayload } from "./types";

type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];

// Refund is supported by the API but not offered in the UI yet. Cash is sent
// as a plain cash payment WITHOUT cash_type/series/cash register — formal
// cash documents (KPO/PPK...) are not faked; if a tenant's Invoice123 requires
// them, the API's validation message is shown to the user.
export const UI_PAYMENT_TYPES = ["transfer", "cash", "other"] as const;
export type UiPaymentType = (typeof UI_PAYMENT_TYPES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AddPaymentInput {
  invoiceId: string;
  idempotencyKey: string;
  type: string;
  amount: string;
  date: string;
}

const bad = (userMessage: string) => new Invoice123Error({ code: "validation", message: `Input: ${userMessage}`, userMessage });

export async function addPayment(ctx: TenantContext, input: AddPaymentInput): Promise<SalesInvoice> {
  if (!UUID_RE.test(String(input.idempotencyKey))) throw bad("Trūksta mokėjimo identifikatoriaus. Atnaujinkite puslapį.");
  if (!(UI_PAYMENT_TYPES as readonly string[]).includes(input.type)) throw bad("Neteisingas mokėjimo būdas.");
  if (!DATE_RE.test(input.date) || Number.isNaN(Date.parse(input.date))) throw bad("Neteisinga mokėjimo data.");
  const amountCents = toCents(String(input.amount ?? ""));
  if (amountCents === null || amountCents <= 0) throw bad("Suma turi būti teigiama.");

  const admin = createAdminClient();
  const { data: invoice, error } = await admin
    .from("sales_invoices").select("*").eq("id", input.invoiceId).eq("user_id", ctx.tenantId).maybeSingle();
  if (error) throw error;
  if (!invoice) throw bad("Sąskaita nerasta.");
  if (invoice.status !== "created" || !invoice.invoice123_invoice_id) throw bad("Mokėjimą galima pridėti tik išrašytai sąskaitai.");

  // Claim the idempotency key first.
  const { data: payment, error: insertError } = await admin.from("sales_invoice_payments").insert({
    user_id: ctx.tenantId,
    invoice_id: invoice.id,
    idempotency_key: input.idempotencyKey,
    payment_type: input.type as UiPaymentType,
    amount: centsToNumber(amountCents),
    payment_date: input.date,
    status: "pending",
    created_by: ctx.tenantId,
  }).select("*").single();
  if (insertError) {
    if (insertError.code === "23505") return invoice; // same click submitted twice — already handled
    throw insertError;
  }

  const remainingCents = (toCents(invoice.total) ?? 0) - (toCents(invoice.paid_total) ?? 0);
  const payload: Invoice123PaymentCreatePayload = {
    type: input.type as UiPaymentType,
    total: centsToString(amountCents),
    date: input.date,
    mark_as_paid: amountCents >= remainingCents,
  };

  try {
    const res = await invoice123Request<{ id?: string; invoice_paid?: boolean } | null>(
      ctx.tenantId,
      `/invoices/${encodeURIComponent(invoice.invoice123_invoice_id)}/payments`,
      { method: "POST", body: payload, permission: "invoice:store", op: "create-payment" }
    );
    await admin.from("sales_invoice_payments")
      .update({ status: "synced", sync_error: null, invoice123_payment_id: res?.id ?? null })
      .eq("id", payment.id).eq("user_id", ctx.tenantId);
    if (typeof res?.invoice_paid === "boolean") {
      await admin.from("sales_invoices").update({ invoice123_paid: res.invoice_paid }).eq("id", invoice.id).eq("user_id", ctx.tenantId);
    } else if (payload.mark_as_paid) {
      await admin.from("sales_invoices").update({ invoice123_paid: true }).eq("id", invoice.id).eq("user_id", ctx.tenantId);
    }
    await audit(ctx.tenantId, { action: "payment_created", result: "ok", entityType: "sales_invoice", entityId: invoice.id, details: { paymentId: payment.id, type: input.type, amount: payload.total } });
  } catch (err) {
    const e = err instanceof Invoice123Error ? err : null;
    const ambiguous = !e || ["timeout", "network", "server_error", "unexpected_response"].includes(e.code);
    await admin.from("sales_invoice_payments")
      .update({
        status: "failed",
        sync_error: ambiguous
          ? "Nežinoma, ar mokėjimas užregistruotas. Paspauskite „Atnaujinti iš Sąskaita123“ prieš kartodami."
          : e!.userMessage,
      })
      .eq("id", payment.id).eq("user_id", ctx.tenantId);
    await audit(ctx.tenantId, { action: "payment_failed", result: "error", entityType: "sales_invoice", entityId: invoice.id, details: { paymentId: payment.id, code: e?.code, message: e?.message ?? errorMessage(err), validation: e?.validationErrors } });
    throw err;
  }

  return recomputePaymentState(ctx.tenantId, invoice.id);
}
