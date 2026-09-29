import "server-only";
import type { Database } from "@/lib/database.types";
import { centsToString, lineTotalCents, milliToString, toCents, toMilli } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantContext, TenantId } from "@/lib/tenant";
import { audit } from "./audit";
import { fetchAllPages, invoice123Request } from "./client";
import { loadInvoice123Config } from "./config";
import { errorMessage, Invoice123Error, type Invoice123ErrorCode } from "./errors";
import type { Invoice123Expense, Invoice123ExpenseCreatePayload, Invoice123Vat } from "./types";

// Purchases (Pajamavimas "invoices" rows = supplier invoices) → Invoice123
// expenses. Same local-first/idempotent rules as sales invoices. All writes
// here use service_role, always filtered by the session tenant.

type Purchase = Database["public"]["Tables"]["invoices"]["Row"];
type PurchaseItem = Database["public"]["Tables"]["invoice_items"]["Row"];

const STALE_SENDING_MS = 2 * 60_000;
const DEFINITE_FAILURES: Invoice123ErrorCode[] = [
  "not_configured", "disabled", "misconfigured", "unauthorized", "forbidden", "not_found", "validation", "rate_limited",
];

export interface SendPurchaseInput {
  purchaseId: string;
  /** VAT % per line, set/confirmed by the user in the send dialog. */
  vatRates?: { itemId: string; vatRate: number }[];
}

export interface PurchaseSendResult {
  purchase: Purchase;
  /** True when an expense with the same supplier document number already existed in Invoice123 and was linked instead of created. */
  linkedExisting: boolean;
}

const bad = (userMessage: string) => new Invoice123Error({ code: "validation", message: `Input: ${userMessage}`, userMessage });
const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("lt");

async function loadPurchase(tenantId: TenantId, id: string): Promise<Purchase> {
  const { data, error } = await createAdminClient().from("invoices").select("*").eq("id", id).eq("user_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Invoice123Error({ code: "not_found", message: `Purchase ${id} not found for tenant`, userMessage: "Pirkimo dokumentas nerastas." });
  return data;
}

async function markPurchase(tenantId: TenantId, id: string, patch: Database["public"]["Tables"]["invoices"]["Update"]) {
  const { data, error } = await createAdminClient().from("invoices").update(patch).eq("id", id).eq("user_id", tenantId).select("*").single();
  if (error) throw error;
  return data;
}

// ---- line maths --------------------------------------------------------------------

interface ExpenseLine {
  title: string;
  qtyMilli: number;
  priceCents: number;
  netCents: number;
  vatRate: number;
  grossCents: number;
}

/**
 * Net per line comes from the document (total_price, be PVM) when present,
 * otherwise qty × unit price. Gross = net × (100 + VAT%) / 100, half-up —
 * the same rule verified on every line of the tenant's existing expenses.
 */
export function buildExpenseLines(items: PurchaseItem[]): { lines: ExpenseLine[]; totalCents: number } {
  if (items.length === 0) throw bad("Pirkimo dokumente nėra eilučių.");
  const lines = items.map((it, i) => {
    const n = i + 1;
    const qtyMilli = toMilli(it.quantity);
    if (qtyMilli === null || qtyMilli <= 0) throw bad(`${n} eilutė: nenurodytas kiekis.`);
    const unit = toCents(it.unit_price);
    const lineNet = toCents(it.total_price);
    const netCents = lineNet ?? (unit !== null ? lineTotalCents(qtyMilli, unit) : null);
    if (netCents === null || netCents < 0) throw bad(`${n} eilutė: nenurodyta kaina.`);
    const priceCents = unit ?? Math.round((netCents * 1000) / qtyMilli);
    const vatRate = it.vat_rate;
    if (vatRate === null || !Number.isInteger(Number(vatRate)) || vatRate < 0 || vatRate > 100) {
      throw bad(`${n} eilutė: nurodykite PVM tarifą (sveikas skaičius, pvz. 21).`);
    }
    const grossCents = Math.floor((netCents * (100 + Number(vatRate)) + 50) / 100);
    return { title: (it.description ?? "").trim() || `Prekė ${n}`, qtyMilli, priceCents, netCents, vatRate: Number(vatRate), grossCents };
  });
  return { lines, totalCents: lines.reduce((s, l) => s + l.grossCents, 0) };
}

/** VAT % → the tenant's own Invoice123 VAT-rate id (tariff "1.2100" ↔ 21 %). */
export function vatIdForRate(vats: Invoice123Vat[], rate: number): string | undefined {
  if (rate === 0) return undefined;
  const hit = vats.find((v) => Math.round((Number(v.tariff) - 1) * 10000) === rate * 100);
  if (!hit) {
    throw new Invoice123Error({
      code: "misconfigured",
      message: `No Invoice123 VAT rate for ${rate}%`,
      userMessage: `Jūsų Sąskaita123 paskyroje nėra ${rate} % PVM tarifo. Pridėkite jį Sąskaita123 ir spauskite „Sinchronizuoti nustatymus“.`,
    });
  }
  return hit.id;
}

export function buildExpensePayload(
  purchase: Pick<Purchase, "invoice_number" | "invoice_date" | "supplier_name">,
  lines: ExpenseLine[],
  totalCents: number,
  opts: { supplierCode: string | null; supplierVat: string | null; supplierAddress: string | null; countryCode: string; expenseTypeId: string; vats: Invoice123Vat[] }
): Invoice123ExpenseCreatePayload {
  return {
    type: "vat-simple",
    series: purchase.invoice_number!.trim(),
    date: purchase.invoice_date!,
    total: centsToString(totalCents),
    supplier: {
      name: purchase.supplier_name!.trim(),
      code: opts.supplierCode,
      vat_code: opts.supplierVat,
      code_type: "company",
      address: opts.supplierAddress,
      country_code: opts.countryCode,
    },
    products: lines.map((l) => ({
      title: l.title,
      price: centsToString(l.priceCents),
      quantity: milliToString(l.qtyMilli),
      total: centsToString(l.grossCents),
      total_vat: centsToString(l.grossCents - l.netCents),
      ...(l.vatRate > 0 ? { company_vat_id: vatIdForRate(opts.vats, l.vatRate) } : {}),
      expense_type_id: opts.expenseTypeId,
    })),
  };
}

// ---- send ----------------------------------------------------------------------------

export async function sendPurchase(ctx: TenantContext, input: SendPurchaseInput): Promise<PurchaseSendResult> {
  const { settings } = await loadInvoice123Config(ctx.tenantId);
  if (!settings?.enabled) throw new Invoice123Error({ code: "disabled", message: "Invoice123 integration disabled" });
  if (!settings.default_expense_type_id) {
    throw new Invoice123Error({ code: "misconfigured", message: "No default expense type", userMessage: "Nustatymuose pasirinkite pirkimų išlaidų tipą." });
  }

  let purchase = await loadPurchase(ctx.tenantId, input.purchaseId);
  if (purchase.invoice123_sync_status === "sent") return { purchase, linkedExisting: false };
  if (purchase.invoice123_sync_status === "needs_reconcile") return reconcilePurchase(ctx, purchase.id);
  if (purchase.invoice123_sync_status === "sending") {
    const stale = purchase.invoice123_sync_started_at && Date.now() - Date.parse(purchase.invoice123_sync_started_at) > STALE_SENDING_MS;
    if (stale) return reconcilePurchase(ctx, purchase.id);
    throw bad("Šis pirkimas jau siunčiamas — palaukite.");
  }

  if (!purchase.invoice_number?.trim()) throw bad("Nenurodytas tiekėjo sąskaitos numeris.");
  if (!purchase.invoice_date) throw bad("Nenurodyta tiekėjo sąskaitos data.");
  if (!purchase.supplier_name?.trim()) throw bad("Nenurodytas tiekėjas.");

  const admin = createAdminClient();

  // Save VAT rates confirmed in the dialog (only for this purchase's own lines).
  for (const v of input.vatRates ?? []) {
    const rate = Number(v.vatRate);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) throw bad("PVM tarifas turi būti sveikas skaičius nuo 0 iki 100.");
    const { error } = await admin.from("invoice_items").update({ vat_rate: rate })
      .eq("id", v.itemId).eq("invoice_id", purchase.id).eq("user_id", ctx.tenantId);
    if (error) throw error;
  }

  const { data: items, error: itemsError } = await admin
    .from("invoice_items").select("*").eq("invoice_id", purchase.id).eq("user_id", ctx.tenantId).order("created_at");
  if (itemsError) throw itemsError;
  const { lines, totalCents } = buildExpenseLines(items ?? []);

  let supplier: Database["public"]["Tables"]["suppliers"]["Row"] | null = null;
  if (purchase.supplier_id) {
    const { data } = await admin.from("suppliers").select("*").eq("id", purchase.supplier_id).eq("user_id", ctx.tenantId).maybeSingle();
    supplier = data;
  }
  const supplierCode = supplier?.code?.trim() || purchase.supplier_code?.trim() || null;

  // Already in Invoice123 (e.g. typed in by hand)? Link instead of duplicating.
  const existing = await findExistingExpense(ctx.tenantId, purchase.invoice_number, supplierCode, purchase.supplier_name);
  if (existing) {
    const done = await markPurchase(ctx.tenantId, purchase.id, {
      invoice123_sync_status: "sent", invoice123_expense_id: existing.id, invoice123_sync_error: null, invoice123_synced_at: new Date().toISOString(),
    });
    await audit(ctx.tenantId, { action: "purchase_linked", result: "ok", entityType: "purchase", entityId: purchase.id, details: { invoice123ExpenseId: existing.id } });
    return { purchase: done, linkedExisting: true };
  }

  // Built BEFORE locking: a config problem (e.g. missing VAT rate) must not leave the purchase stuck in 'sending'.
  const payload = buildExpensePayload(purchase, lines, totalCents, {
    supplierCode,
    supplierVat: supplier?.vat_code?.trim() || purchase.supplier_vat?.trim() || null,
    supplierAddress: supplier?.address?.trim() || null,
    countryCode: settings.default_country_code || "LT",
    expenseTypeId: settings.default_expense_type_id!,
    vats: settings.remote_options?.vats ?? [],
  });

  // Atomic lock: only one concurrent send can move not_sent/failed → sending.
  const { data: locked, error: lockError } = await admin
    .from("invoices")
    .update({ invoice123_sync_status: "sending", invoice123_sync_started_at: new Date().toISOString(), invoice123_sync_error: null })
    .eq("id", purchase.id).eq("user_id", ctx.tenantId).in("invoice123_sync_status", ["not_sent", "failed"])
    .select("*");
  if (lockError) throw lockError;
  if (!locked?.length) throw bad("Šis pirkimas jau siunčiamas — palaukite.");
  purchase = locked[0];

  try {
    const created = await invoice123Request<{ id?: string } | null>(ctx.tenantId, "/expenses", {
      method: "POST", body: payload, permission: "expense:store", op: "create-expense",
    });
    if (!created?.id) throw new Invoice123Error({ code: "unexpected_response", message: "POST /expenses returned no id" });
    const done = await markPurchase(ctx.tenantId, purchase.id, {
      invoice123_sync_status: "sent", invoice123_expense_id: created.id, invoice123_sync_error: null, invoice123_synced_at: new Date().toISOString(),
    });
    await audit(ctx.tenantId, { action: "purchase_sent", result: "ok", entityType: "purchase", entityId: purchase.id, details: { invoice123ExpenseId: created.id, total: payload.total } });
    return { purchase: done, linkedExisting: false };
  } catch (err) {
    const e = err instanceof Invoice123Error ? err : null;
    await audit(ctx.tenantId, { action: "purchase_send_failed", result: "error", entityType: "purchase", entityId: purchase.id, details: { code: e?.code, message: e?.message ?? errorMessage(err), validation: e?.validationErrors } });
    if (e && DEFINITE_FAILURES.includes(e.code)) {
      await markPurchase(ctx.tenantId, purchase.id, { invoice123_sync_status: "failed", invoice123_sync_error: e.userMessage });
      throw err;
    }
    await markPurchase(ctx.tenantId, purchase.id, { invoice123_sync_status: "needs_reconcile", invoice123_sync_error: "Nežinoma, ar pirkimas užregistruotas Sąskaita123. Tikrinama..." });
    return reconcilePurchase(ctx, purchase.id);
  }
}

async function findExistingExpense(
  tenantId: TenantId,
  documentNumber: string,
  supplierCode: string | null,
  supplierName: string | null
): Promise<Invoice123Expense | null> {
  const all = await fetchAllPages<Invoice123Expense>(tenantId, "/expenses", { permission: "expense:index", requireEnabled: false, op: "find-expense" });
  const { data: linked } = await createAdminClient()
    .from("invoices").select("invoice123_expense_id").eq("user_id", tenantId).not("invoice123_expense_id", "is", null);
  const taken = new Set((linked ?? []).map((r) => r.invoice123_expense_id));

  const matches = all.filter((e) => {
    if (taken.has(e.id) || norm(e.series) !== norm(documentNumber)) return false;
    if (supplierCode && e.supplier?.code) return e.supplier.code.trim() === supplierCode;
    return norm(e.supplier?.name) === norm(supplierName);
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Resolves an unknown send outcome by looking for the expense (same document number + total). */
export async function reconcilePurchase(ctx: TenantContext, purchaseId: string): Promise<PurchaseSendResult> {
  const purchase = await loadPurchase(ctx.tenantId, purchaseId);
  if (purchase.invoice123_sync_status !== "needs_reconcile" && purchase.invoice123_sync_status !== "sending") {
    return { purchase, linkedExisting: false };
  }
  const found = purchase.invoice_number
    ? await findExistingExpense(ctx.tenantId, purchase.invoice_number, purchase.supplier_code, purchase.supplier_name)
    : null;
  if (found) {
    const done = await markPurchase(ctx.tenantId, purchase.id, {
      invoice123_sync_status: "sent", invoice123_expense_id: found.id, invoice123_sync_error: null, invoice123_synced_at: new Date().toISOString(),
    });
    await audit(ctx.tenantId, { action: "purchase_linked", result: "ok", entityType: "purchase", entityId: purchase.id, details: { invoice123ExpenseId: found.id, reconciled: true } });
    return { purchase: done, linkedExisting: false };
  }
  const done = await markPurchase(ctx.tenantId, purchase.id, {
    invoice123_sync_status: "failed", invoice123_sync_error: "Pirkimas Sąskaita123 neužregistruotas. Galite bandyti dar kartą.",
  });
  return { purchase: done, linkedExisting: false };
}

// ---- mirror Invoice123 → GVET ------------------------------------------------------

/**
 * Keeps purchase sync status honest: a purchase marked 'sent' whose expense
 * was deleted in Invoice123 goes back to 'not_sent' (the purchase and its
 * stock stay — they are real inventory), and stuck sends are reconciled.
 * Runs every time Pajamavimas is opened.
 */
export async function refreshPurchases(ctx: TenantContext): Promise<{ reset: string[]; resolved: number }> {
  const admin = createAdminClient();
  const { data: tracked, error } = await admin
    .from("invoices")
    .select("id, invoice_number, supplier_name, invoice123_expense_id, invoice123_sync_status, invoice123_synced_at")
    .eq("user_id", ctx.tenantId)
    .in("invoice123_sync_status", ["sent", "sending", "needs_reconcile"]);
  if (error) throw error;
  if (!tracked?.length) return { reset: [], resolved: 0 };

  const fetchStartedAt = new Date().toISOString();
  const remote = await fetchAllPages<Invoice123Expense>(ctx.tenantId, "/expenses", { permission: "expense:index", requireEnabled: false, op: "refresh-purchases" });
  const remoteIds = new Set(remote.map((e) => e.id));

  const reset: string[] = [];
  let resolved = 0;
  for (const p of tracked) {
    if (p.invoice123_sync_status === "sent") {
      if (remote.length === 0 || remoteIds.has(p.invoice123_expense_id!) || (p.invoice123_synced_at ?? "") > fetchStartedAt) continue;
      await markPurchase(ctx.tenantId, p.id, {
        invoice123_sync_status: "not_sent", invoice123_expense_id: null, invoice123_synced_at: null,
        invoice123_sync_error: "Išlaida ištrinta Sąskaita123 — galite siųsti iš naujo.",
      });
      reset.push(`${p.supplier_name ?? ""} ${p.invoice_number ?? ""}`.trim());
      await audit(ctx.tenantId, { action: "purchase_deleted_remote", result: "ok", entityType: "purchase", entityId: p.id, details: { invoice123ExpenseId: p.invoice123_expense_id } });
    } else {
      const r = await reconcilePurchase(ctx, p.id);
      if (r.purchase.invoice123_sync_status !== p.invoice123_sync_status) resolved++;
    }
  }
  return { reset, resolved };
}
