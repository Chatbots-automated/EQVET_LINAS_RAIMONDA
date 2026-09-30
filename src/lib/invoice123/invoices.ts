import "server-only";
import type { Database, PaymentStatus, PaymentType } from "@/lib/database.types";
import { centsToNumber, centsToString, lineTotalCents, milliToString, toCents, toMilli } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantContext, TenantId } from "@/lib/tenant";
import { audit } from "./audit";
import { importClients } from "./clients";
import { fetchAllPages, invoice123Request } from "./client";
import { assertReadyForInvoicing, loadInvoice123Config, type ReadyInvoice123Settings } from "./config";
import { errorMessage, Invoice123Error, type Invoice123ErrorCode } from "./errors";
import type { Invoice123Invoice, Invoice123InvoiceCreatePayload } from "./types";

type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];

const MAX_LINES = 100;
const STALE_CREATING_MS = 2 * 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Outcomes where Invoice123 definitely did NOT create anything → safe to retry. */
const DEFINITE_FAILURES: Invoice123ErrorCode[] = [
  "not_configured", "disabled", "misconfigured", "unauthorized", "forbidden", "not_found", "validation", "rate_limited",
];

export interface InvoiceLineInput {
  title: string;
  description?: string | null;
  quantity: string;
  unitPrice: string;
  productId?: string | null;
}

export interface CreateInvoiceInput {
  idempotencyKey: string;
  clientId: string;
  /** Visits this invoice covers (all must belong to the client's tenant). */
  visitIds?: string[];
  date: string;
  dateDue: string | null;
  lines: InvoiceLineInput[];
}

const bad = (userMessage: string) => new Invoice123Error({ code: "validation", message: `Input: ${userMessage}`, userMessage });

// ---- validation + server-side totals ---------------------------------------------

interface ValidatedLine {
  title: string;
  description: string | null;
  qtyMilli: number;
  priceCents: number;
  totalCents: number;
  productId: string | null;
}

/** Never trusts browser totals: every amount is recomputed here from qty × price. */
export function validateLines(lines: InvoiceLineInput[]): { lines: ValidatedLine[]; totalCents: number } {
  if (!Array.isArray(lines) || lines.length === 0) throw bad("Sąskaitoje turi būti bent viena eilutė.");
  if (lines.length > MAX_LINES) throw bad(`Daugiausia ${MAX_LINES} eilučių.`);

  const out = lines.map((l, i) => {
    const n = i + 1;
    const title = String(l.title ?? "").trim();
    if (!title) throw bad(`${n} eilutė: įveskite pavadinimą.`);
    if (title.length > 255) throw bad(`${n} eilutė: pavadinimas per ilgas.`);
    const qtyMilli = toMilli(String(l.quantity ?? ""));
    if (qtyMilli === null || qtyMilli <= 0) throw bad(`${n} eilutė: kiekis turi būti teigiamas skaičius.`);
    const priceCents = toCents(String(l.unitPrice ?? ""));
    if (priceCents === null || priceCents < 0) throw bad(`${n} eilutė: įveskite kainą.`);
    const description = l.description ? String(l.description).trim().slice(0, 1000) || null : null;
    return { title, description, qtyMilli, priceCents, totalCents: lineTotalCents(qtyMilli, priceCents), productId: l.productId || null };
  });

  const totalCents = out.reduce((s, l) => s + l.totalCents, 0);
  if (totalCents <= 0) throw bad("Sąskaitos suma turi būti didesnė už 0.");
  return { lines: out, totalCents };
}

function validateDates(date: string, dateDue: string | null) {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw bad("Neteisinga sąskaitos data.");
  if (dateDue !== null && (!DATE_RE.test(dateDue) || Number.isNaN(Date.parse(dateDue)))) throw bad("Neteisinga apmokėjimo data.");
  if (dateDue !== null && dateDue < date) throw bad("Apmokėti iki negali būti ankstesnė už sąskaitos datą.");
}

// ---- payload ----------------------------------------------------------------------

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export function buildInvoicePayload(
  settings: ReadyInvoice123Settings,
  client: ClientRow,
  lines: ValidatedLine[],
  totalCents: number,
  date: string,
  dateDue: string | null
): Invoice123InvoiceCreatePayload {
  return {
    type: "simple",
    series_id: settings.default_series_id,
    ...(settings.default_activity_id ? { activity_id: settings.default_activity_id } : {}),
    date,
    date_due: dateDue,
    date_due_show: dateDue !== null,
    total: centsToString(totalCents),
    issued_by: settings.issued_by,
    client: {
      client_id: client.external_id,
      name: client.name,
      address: client.address,
      code: client.company_code,
      code_type: client.is_company ? "company" : "personal",
      vat_code: client.vat_code,
      email: client.email,
      phone: client.phone,
      country_code: client.country_code || settings.default_country_code,
    },
    banks: settings.default_bank_id ? [settings.default_bank_id] : [],
    products: lines.map((l) => ({
      title: l.title,
      description: l.description,
      price: centsToString(l.priceCents),
      quantity: milliToString(l.qtyMilli),
      total: centsToString(l.totalCents),
      unit_id: settings.default_unit_id,
    })),
    language: settings.default_language,
  };
}

// ---- create ------------------------------------------------------------------------

/**
 * Local-first, idempotent invoice creation:
 *   1. validate + recompute totals server-side
 *   2. claim the idempotency key: insert (or atomically re-lock a failed) row
 *      with status 'creating' — a second click/refresh with the same key can
 *      never reach step 3 while the first is in flight or after it succeeded
 *   3. POST /invoices (never auto-retried)
 *   4. success → 'created' + official number from Invoice123
 *      definite failure → 'failed' (safe to retry)
 *      ambiguous (timeout/5xx) → 'needs_reconcile', then look for it in Invoice123
 */
export async function createInvoice(ctx: TenantContext, input: CreateInvoiceInput): Promise<SalesInvoice> {
  if (!UUID_RE.test(String(input.idempotencyKey))) throw bad("Trūksta sąskaitos identifikatoriaus. Atnaujinkite puslapį.");
  validateDates(input.date, input.dateDue);
  const { lines, totalCents } = validateLines(input.lines);

  const { settings } = await loadInvoice123Config(ctx.tenantId);
  assertReadyForInvoicing(settings);
  if (settings.company_vat_enabled) {
    // Deliberately not guessing VAT maths/fields until verified on a real VAT-payer account.
    throw new Invoice123Error({
      code: "misconfigured",
      message: "VAT-payer tenant: VAT invoices not yet supported",
      userMessage: "Jūsų Sąskaita123 paskyra yra PVM mokėtojo — PVM sąskaitų išrašymas iš EQ VET dar neįjungtas.",
    });
  }

  // Ownership checks go through the user's own session (RLS).
  const { data: client, error: clientError } = await ctx.supabase
    .from("clients").select("*").eq("id", input.clientId).eq("user_id", ctx.tenantId).maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw bad("Klientas nerastas.");
  if (client.external_source !== "invoice123" || !client.external_id) {
    throw bad("Klientas dar nesusietas su Sąskaita123.");
  }

  const visitIds = [...new Set(input.visitIds ?? [])];
  if (visitIds.length > MAX_LINES || visitIds.some((id) => !UUID_RE.test(id))) throw bad("Neteisingas vizitų sąrašas.");
  let animalId: string | null = null;
  if (visitIds.length > 0) {
    const { data: visits, error } = await ctx.supabase
      .from("visits").select("id, animal_id").in("id", visitIds).eq("user_id", ctx.tenantId);
    if (error) throw error;
    if ((visits ?? []).length !== visitIds.length) throw bad("Vizitas nerastas.");
    // The invoice points at one animal only when every visit is about the same one.
    const animals = new Set((visits ?? []).map((v) => v.animal_id));
    animalId = animals.size === 1 ? [...animals][0] : null;
  }

  const admin = createAdminClient();
  const row = await claimInvoiceRow(ctx.tenantId, input.idempotencyKey, {
    user_id: ctx.tenantId,
    client_id: client.id,
    visit_id: visitIds[0] ?? null,
    animal_id: animalId,
    source: "gvet",
    idempotency_key: input.idempotencyKey,
    status: "creating",
    creation_started_at: new Date().toISOString(),
    sync_error: null,
    invoice123_client_id: client.external_id,
    invoice_type: "simple",
    date: input.date,
    date_due: input.dateDue,
    subtotal: centsToNumber(totalCents),
    vat_total: 0,
    total: centsToNumber(totalCents),
    currency_code: "EUR",
    language: settings.default_language,
    issued_by: settings.issued_by,
    client_name: client.name,
    client_code: client.company_code,
    client_vat_code: client.vat_code,
    client_address: client.address,
    client_country_code: client.country_code,
    created_by: ctx.tenantId,
  });
  if (row.status !== "creating") return row; // already created / needs reconcile — nothing to send

  // Replace the line snapshot (a retried 'failed' draft may have new lines).
  await admin.from("sales_invoice_items").delete().eq("invoice_id", row.id).eq("user_id", ctx.tenantId);
  const { error: itemsError } = await admin.from("sales_invoice_items").insert(
    lines.map((l, i) => ({
      user_id: ctx.tenantId,
      invoice_id: row.id,
      position: i,
      title: l.title,
      description: l.description,
      quantity: Number(milliToString(l.qtyMilli)),
      unit_price: centsToNumber(l.priceCents),
      line_total: centsToNumber(l.totalCents),
      unit_name: settings.default_unit_name,
      product_id: l.productId,
    }))
  );
  if (itemsError) {
    await markInvoice(ctx.tenantId, row.id, { status: "failed", sync_error: "Nepavyko išsaugoti sąskaitos eilučių." });
    throw itemsError;
  }

  // Which visits this invoice covers (replaced on a retried draft, like the lines).
  await admin.from("sales_invoice_visits").delete().eq("invoice_id", row.id).eq("user_id", ctx.tenantId);
  if (visitIds.length > 0) {
    const { error: linkError } = await admin
      .from("sales_invoice_visits")
      .insert(visitIds.map((visit_id) => ({ invoice_id: row.id, visit_id, user_id: ctx.tenantId })));
    if (linkError) {
      await markInvoice(ctx.tenantId, row.id, { status: "failed", sync_error: "Nepavyko susieti sąskaitos su vizitais." });
      throw linkError;
    }
  }

  const payload = buildInvoicePayload(settings, client, lines, totalCents, input.date, input.dateDue);

  try {
    const created = await invoice123Request<Partial<Invoice123Invoice> | null>(ctx.tenantId, "/invoices", {
      method: "POST",
      body: payload,
      permission: "invoice:store",
      op: "create-invoice",
    });
    if (!created?.id) throw new Invoice123Error({ code: "unexpected_response", message: "POST /invoices returned no id" });

    let seriesTitle = created.series_title ?? null;
    let seriesNumber = created.series_number ?? null;
    if (!seriesTitle || seriesNumber == null) {
      const remote = await findRemoteInvoice(ctx.tenantId, created.id);
      seriesTitle = remote?.series_title ?? seriesTitle;
      seriesNumber = remote?.series_number ?? seriesNumber;
    }

    const done = await markInvoice(ctx.tenantId, row.id, {
      status: "created",
      sync_error: null,
      invoice123_invoice_id: created.id,
      series_title: seriesTitle,
      series_number: seriesNumber,
      invoice123_paid: created.paid ?? false,
    });
    await audit(ctx.tenantId, { action: "invoice_created", result: "ok", entityType: "sales_invoice", entityId: row.id, details: { invoice123InvoiceId: created.id, number: `${seriesTitle ?? ""} ${seriesNumber ?? ""}`.trim(), total: centsToString(totalCents) } });
    return done;
  } catch (err) {
    const e = err instanceof Invoice123Error ? err : null;
    const definite = e !== null && DEFINITE_FAILURES.includes(e.code);
    await audit(ctx.tenantId, { action: "invoice_creation_failed", result: "error", entityType: "sales_invoice", entityId: row.id, details: { code: e?.code, status: e?.status, message: e?.message ?? errorMessage(err), validation: e?.validationErrors } });

    if (definite) {
      await markInvoice(ctx.tenantId, row.id, { status: "failed", sync_error: e!.userMessage });
      throw err;
    }
    // Outcome unknown — the invoice may exist in Invoice123. Never retry blindly.
    await markInvoice(ctx.tenantId, row.id, { status: "needs_reconcile", sync_error: "Nežinoma, ar sąskaita sukurta Sąskaita123. Tikrinama..." });
    return reconcileInvoice(ctx, row.id);
  }
}

/**
 * Claims the idempotency key. Returns the row with status 'creating' only if
 * THIS call won the right to send it to Invoice123; otherwise returns the
 * existing row unchanged (created / needs_reconcile) or throws (in flight).
 */
async function claimInvoiceRow(
  tenantId: TenantId,
  key: string,
  values: Database["public"]["Tables"]["sales_invoices"]["Insert"]
): Promise<SalesInvoice> {
  const admin = createAdminClient();
  const { data: inserted, error } = await admin.from("sales_invoices").insert(values).select("*").single();
  if (!error) return inserted;
  if (error.code !== "23505") throw error;

  const { data: existing, error: readError } = await admin
    .from("sales_invoices").select("*").eq("user_id", tenantId).eq("idempotency_key", key).single();
  if (readError) throw readError;

  if (existing.status === "created" || existing.status === "needs_reconcile") return existing;
  if (existing.status === "creating") {
    throw new Invoice123Error({ code: "validation", message: "Invoice already being created", userMessage: "Ši sąskaita jau kuriama — palaukite." });
  }

  // 'failed' → atomically re-lock (only one concurrent retry can win).
  const { data: relocked, error: lockError } = await admin
    .from("sales_invoices")
    .update({ ...values, status: "creating" })
    .eq("id", existing.id)
    .eq("user_id", tenantId)
    .eq("status", "failed")
    .select("*");
  if (lockError) throw lockError;
  if (!relocked?.length) {
    throw new Invoice123Error({ code: "validation", message: "Lost retry race", userMessage: "Ši sąskaita jau kuriama — palaukite." });
  }
  return relocked[0];
}

async function markInvoice(tenantId: TenantId, id: string, patch: Database["public"]["Tables"]["sales_invoices"]["Update"]) {
  const { data, error } = await createAdminClient()
    .from("sales_invoices").update(patch).eq("id", id).eq("user_id", tenantId).select("*").single();
  if (error) throw error;
  return data;
}

async function loadOwnInvoice(tenantId: TenantId, id: string): Promise<SalesInvoice> {
  const { data, error } = await createAdminClient()
    .from("sales_invoices").select("*").eq("id", id).eq("user_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Invoice123Error({ code: "not_found", message: `Sales invoice ${id} not found for tenant`, userMessage: "Sąskaita nerasta." });
  return data;
}

// ---- reconcile ---------------------------------------------------------------------

async function findRemoteInvoice(tenantId: TenantId, invoice123Id: string): Promise<Invoice123Invoice | null> {
  // GET /invoices/{id} is not available (404) — scan the list.
  const all = await fetchAllPages<Invoice123Invoice>(tenantId, "/invoices", { permission: "invoice:index", requireEnabled: false, op: "find-invoice" });
  return all.find((i) => i.id === invoice123Id) ?? null;
}

/**
 * Resolves an invoice whose creation outcome is unknown by looking for it in
 * Invoice123 (same client, date and total, not linked to another local row).
 *   exactly one match → 'created'
 *   none              → 'failed' (retry is safe)
 *   several           → stays 'needs_reconcile' for a human to check
 */
export async function reconcileInvoice(ctx: TenantContext, invoiceId: string): Promise<SalesInvoice> {
  const row = await loadOwnInvoice(ctx.tenantId, invoiceId);
  const stale = row.status === "creating" && row.creation_started_at && Date.now() - Date.parse(row.creation_started_at) > STALE_CREATING_MS;
  if (row.status !== "needs_reconcile" && !stale) return row;

  const all = await fetchAllPages<Invoice123Invoice>(ctx.tenantId, "/invoices", { permission: "invoice:index", requireEnabled: false, op: "reconcile" });
  const { data: linked } = await createAdminClient()
    .from("sales_invoices").select("invoice123_invoice_id").eq("user_id", ctx.tenantId).not("invoice123_invoice_id", "is", null);
  const taken = new Set((linked ?? []).map((r) => r.invoice123_invoice_id));
  const wantCents = toCents(row.total);

  const matches = all.filter(
    (i) => !taken.has(i.id) && i.client?.client_id === row.invoice123_client_id && i.date === row.date && toCents(i.total) === wantCents
  );

  if (matches.length === 1) {
    const m = matches[0];
    const done = await markInvoice(ctx.tenantId, row.id, {
      status: "created", sync_error: null, invoice123_invoice_id: m.id, series_title: m.series_title, series_number: m.series_number, invoice123_paid: m.paid,
    });
    await audit(ctx.tenantId, { action: "invoice_reconciled", result: "ok", entityType: "sales_invoice", entityId: row.id, details: { invoice123InvoiceId: m.id } });
    return done;
  }
  if (matches.length === 0) {
    return markInvoice(ctx.tenantId, row.id, { status: "failed", sync_error: "Sąskaita Sąskaita123 nesukurta. Galite bandyti dar kartą." });
  }
  return markInvoice(ctx.tenantId, row.id, {
    status: "needs_reconcile",
    sync_error: `Sąskaita123 rastos ${matches.length} galimai atitinkančios sąskaitos (${matches.map((m) => `${m.series_title} ${m.series_number}`).join(", ")}). Patikrinkite rankiniu būdu.`,
  });
}

// ---- import / refresh ----------------------------------------------------------------

/**
 * Imports every Invoice123 invoice of THIS tenant and refreshes paid state +
 * payments of ones already known. Repeatable — keyed by invoice123_invoice_id
 * and invoice123_payment_id, so re-running never duplicates anything.
 */
export interface InvoiceSyncResult {
  inserted: number;
  /** Local invoices whose paid state / payments / number changed. */
  updated: number;
  /** Numbers of invoices deleted in Invoice123 and therefore removed here. */
  removed: string[];
}

export async function importInvoices(ctx: TenantContext): Promise<InvoiceSyncResult> {
  await importClients(ctx); // so every invoice's client can be mapped

  // Anything changed locally after this moment can't be judged against the
  // list we are about to fetch (e.g. an invoice created while syncing).
  const fetchStartedAt = new Date().toISOString();
  const remote = await fetchAllPages<Invoice123Invoice>(ctx.tenantId, "/invoices", { permission: "invoice:index", requireEnabled: false, op: "import-invoices" });
  const admin = createAdminClient();

  const [{ data: localInvoices, error: e1 }, { data: clients, error: e2 }] = await Promise.all([
    admin.from("sales_invoices")
      .select("id, invoice123_invoice_id, invoice123_paid, series_title, series_number, status, pdf_storage_path, updated_at")
      .eq("user_id", ctx.tenantId).not("invoice123_invoice_id", "is", null),
    ctx.supabase.from("clients").select("id, external_id").eq("user_id", ctx.tenantId).eq("external_source", "invoice123"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const localRows = new Map((localInvoices ?? []).map((r) => [r.invoice123_invoice_id!, r]));
  const localByRemote = new Map((localInvoices ?? []).map((r) => [r.invoice123_invoice_id!, r.id]));
  const clientByRemote = new Map((clients ?? []).map((c) => [c.external_id!, c.id]));

  let inserted = 0;
  let updated = 0;

  for (const inv of remote) {
    let localId = localByRemote.get(inv.id);
    const totalCents = toCents(inv.total) ?? 0;
    let changed = false;

    if (localId) {
      const cur = localRows.get(inv.id)!;
      if (cur.invoice123_paid !== inv.paid || cur.series_title !== inv.series_title || cur.series_number !== inv.series_number) {
        const { error } = await admin.from("sales_invoices")
          .update({ invoice123_paid: inv.paid, series_title: inv.series_title, series_number: inv.series_number })
          .eq("id", localId).eq("user_id", ctx.tenantId);
        if (error) throw error;
        changed = true;
      }
    } else {
      const { data: row, error } = await admin.from("sales_invoices").insert({
        user_id: ctx.tenantId,
        client_id: inv.client?.client_id ? clientByRemote.get(inv.client.client_id) ?? null : null,
        source: "invoice123_import",
        status: "created",
        invoice123_invoice_id: inv.id,
        invoice123_client_id: inv.client?.client_id ?? null,
        series_title: inv.series_title,
        series_number: inv.series_number,
        invoice_type: inv.type,
        date: inv.date,
        date_due: inv.date_due,
        subtotal: centsToNumber(totalCents),
        vat_total: 0,
        total: centsToNumber(totalCents),
        invoice123_paid: inv.paid,
        currency_code: inv.currency || "EUR",
        issued_by: inv.issued_by,
        client_name: inv.client?.name ?? "—",
        client_code: inv.client?.code || null,
        client_vat_code: inv.client?.vat_code || null,
        client_address: inv.client?.address || null,
        client_country_code: inv.client?.country_code || null,
      }).select("id").single();
      if (error) {
        if (error.code === "23505") continue; // concurrent import already inserted it
        throw error;
      }
      localId = row.id;
      const { error: itemsError } = await admin.from("sales_invoice_items").insert(
        (inv.products ?? []).map((p, i) => ({
          user_id: ctx.tenantId,
          invoice_id: row.id,
          position: i,
          title: p.title,
          description: p.description,
          quantity: Number(p.quantity),
          unit_price: Number(p.price),
          line_total: centsToNumber(toCents(p.total) ?? 0),
          unit_name: p.unit_name,
        }))
      );
      if (itemsError) throw itemsError;
      inserted++;
    }

    const newPayments = await syncRemotePayments(ctx.tenantId, localId, inv, fetchStartedAt);
    if (changed || newPayments > 0 || !localRows.has(inv.id)) await recomputePaymentState(ctx.tenantId, localId);
    if ((changed || newPayments > 0) && localRows.has(inv.id)) updated++;
  }

  // ---- invoices deleted in Invoice123 ----
  // Mirror the deletion (lines + payments cascade, cached PDF removed); the
  // audit log keeps the record. Never on an empty remote list, and never for
  // rows touched after the list was fetched.
  const remoteIds = new Set(remote.map((i) => i.id));
  const removed: string[] = [];
  if (remote.length > 0) {
    for (const row of localInvoices ?? []) {
      if (remoteIds.has(row.invoice123_invoice_id!) || row.status !== "created" || row.updated_at > fetchStartedAt) continue;
      const { error } = await admin.from("sales_invoices").delete().eq("id", row.id).eq("user_id", ctx.tenantId);
      if (error) throw error;
      if (row.pdf_storage_path) await admin.storage.from("invoice-pdfs").remove([row.pdf_storage_path]);
      const number = `${row.series_title ?? ""} ${row.series_number ?? ""}`.trim();
      removed.push(number);
      await audit(ctx.tenantId, { action: "invoice_deleted_remote", result: "ok", entityType: "sales_invoice", entityId: row.id, details: { invoice123InvoiceId: row.invoice123_invoice_id, number } });
    }
  }

  await audit(ctx.tenantId, { action: "invoices_imported", result: "ok", details: { remote: remote.length, inserted, updated, removed: removed.length } });
  return { inserted, updated, removed };
}

/** Mirrors an invoice's payments; returns how many local payments were added or removed. */
async function syncRemotePayments(tenantId: TenantId, invoiceId: string, inv: Invoice123Invoice, fetchStartedAt: string): Promise<number> {
  const admin = createAdminClient();
  const { data: local, error } = await admin.from("sales_invoice_payments").select("*").eq("user_id", tenantId).eq("invoice_id", invoiceId);
  if (error) throw error;
  const known = new Set((local ?? []).map((p) => p.invoice123_payment_id).filter(Boolean));
  let changes = 0;

  // Payments deleted in Invoice123 (only ones we know by id, not touched since the fetch).
  const remoteIds = new Set((inv.payments ?? []).map((p) => p.id));
  for (const l of local ?? []) {
    if (l.status === "synced" && l.invoice123_payment_id && !remoteIds.has(l.invoice123_payment_id) && l.updated_at <= fetchStartedAt) {
      const { error: delError } = await admin.from("sales_invoice_payments").delete().eq("id", l.id).eq("user_id", tenantId);
      if (delError) throw delError;
      changes++;
    }
  }

  for (const p of inv.payments ?? []) {
    if (known.has(p.id)) continue;
    changes++;
    const amount = toCents(p.total) ?? 0;
    // Invoice123 reports cash payments with type=false (verified live).
    const type: PaymentType = p.type === false ? "cash" : (["transfer", "cash", "refund", "other"] as const).find((t) => t === p.type) ?? "other";

    // A payment WE sent whose response carried no id: adopt it instead of duplicating.
    const orphan = (local ?? []).find(
      (l) => !l.invoice123_payment_id && l.status !== "failed" && toCents(l.amount) === amount && l.payment_date === p.date
    );
    if (orphan) {
      await admin.from("sales_invoice_payments").update({ invoice123_payment_id: p.id, status: "synced", sync_error: null }).eq("id", orphan.id).eq("user_id", tenantId);
      orphan.invoice123_payment_id = p.id;
      continue;
    }
    const { error: insertError } = await admin.from("sales_invoice_payments").insert({
      user_id: tenantId, invoice_id: invoiceId, invoice123_payment_id: p.id, payment_type: type, amount: centsToNumber(amount), payment_date: p.date, status: "synced",
    });
    if (insertError && insertError.code !== "23505") throw insertError;
  }
  return changes;
}

/** paid_total = Σ synced payments (refunds negative); status derived, Invoice123's paid flag wins. */
export async function recomputePaymentState(tenantId: TenantId, invoiceId: string): Promise<SalesInvoice> {
  const admin = createAdminClient();
  const [invoice, { data: payments, error }] = await Promise.all([
    loadOwnInvoice(tenantId, invoiceId),
    admin.from("sales_invoice_payments").select("payment_type, amount, status").eq("user_id", tenantId).eq("invoice_id", invoiceId),
  ]);
  if (error) throw error;

  const paidCents = (payments ?? [])
    .filter((p) => p.status === "synced")
    .reduce((s, p) => s + (p.payment_type === "refund" ? -1 : 1) * (toCents(p.amount) ?? 0), 0);
  const totalCents = toCents(invoice.total) ?? 0;

  let status: PaymentStatus =
    paidCents <= 0 ? "unpaid" : paidCents < totalCents ? "partial" : paidCents === totalCents ? "paid" : "overpaid";
  if (invoice.invoice123_paid && status !== "overpaid") status = "paid";

  return markInvoice(tenantId, invoiceId, { paid_total: centsToNumber(paidCents), payment_status: status });
}
