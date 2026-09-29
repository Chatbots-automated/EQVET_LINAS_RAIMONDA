// Invoice123 (Sąskaita123) public API v1.0 types — https://app.invoice123.com/api/v1.0
//
// Shapes verified against live responses (2026-09-28). Money fields are
// strings in the API ("61.00"); keep them as strings at this boundary.
//
// No "server-only" import here: these are plain types, and the settings UI
// reads Invoice123RemoteOptions from invoice123_settings.remote_options.

/** Every endpoint wraps its payload as { data } on success, { data: null, error } on failure. */
export interface Invoice123Envelope<T> {
  data: T;
  error?: { message: string; errors?: Record<string, string[]> };
}

export interface Invoice123Pagination {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface Invoice123Page<T> {
  result: T[];
  pagination: Invoice123Pagination;
}

export interface Invoice123Series {
  id: string;
  title: string;
  /** "simple" = sąskaita faktūra, "commercial" = komercinis pasiūlymas, ... */
  type: string;
}

export interface Invoice123Unit {
  id: string;
  name: string;
}

export interface Invoice123Vat {
  id: string;
  /** Multiplier as a string, e.g. "1.2100" for 21 %. */
  tariff: string;
  vat_code: string;
  inverse_vat_id: string | null;
}

export interface Invoice123Activity {
  id: string;
  name?: string;
  title?: string;
}

export interface Invoice123Bank {
  id: string;
  account: string;
  title: string;
  code: string | null;
  swift: string | null;
  default: boolean;
}

export interface Invoice123CashRegister {
  id: string;
  name?: string;
  title?: string;
}

export interface Invoice123Company {
  vat_enabled: boolean;
  /** e.g. "none" for a non-VAT payer. */
  vat_status: string;
}

export interface Invoice123ClientListItem {
  id: string;
  name: string;
  code: string | null;
  client_code: string | null;
  vat_code: string | null;
  address: string | null;
  country_code: string | null;
}

/** Snapshot of a tenant's Invoice123 option lists, cached in invoice123_settings.remote_options. */
export interface Invoice123RemoteOptions {
  series: Invoice123Series[];
  units: Invoice123Unit[];
  vats: Invoice123Vat[];
  banks: Invoice123Bank[];
  activities: Invoice123Activity[];
  cash_registers: Invoice123CashRegister[];
  company: Invoice123Company | null;
  /**
   * Expense types seen on the tenant's existing expenses. Invoice123 requires
   * expense_type_id on every expense line but has no endpoint to list them.
   */
  expense_types?: Invoice123ExpenseTypeOption[];
  /** Resources the token could not read (e.g. missing permission) — surfaced in the settings UI. */
  unavailable: string[];
}

// ---- clients -------------------------------------------------------------------

export type Invoice123CodeType = "company" | "personal";

export interface Invoice123ClientCreatePayload {
  name: string;
  code: string | null;
  client_code: null;
  type: "client";
  code_type: Invoice123CodeType;
  phone: string | null;
  address: string | null;
  delivery_address: null;
  note: string | null;
  email: string | null;
  vat_enabled: boolean;
  vat_code: string | null;
  country_code: string;
  use_client_pay_term: boolean;
  pay_term: number;
}

// ---- invoices ------------------------------------------------------------------

export interface Invoice123InvoiceClient {
  client_id: string | null;
  name: string;
  address: string | null;
  code: string | null;
  code_type: Invoice123CodeType;
  vat_code: string | null;
  email: string | null;
  phone: string | null;
  country_code: string;
}

export interface Invoice123InvoiceProductPayload {
  title: string;
  description: string | null;
  price: string;
  quantity: string;
  total: string;
  unit_id: string;
}

export interface Invoice123InvoiceCreatePayload {
  type: "simple";
  series_id: string;
  activity_id?: string;
  date: string;
  date_due: string | null;
  date_due_show: boolean;
  total: string;
  issued_by: string | null;
  client: Invoice123InvoiceClient;
  banks: string[];
  products: Invoice123InvoiceProductPayload[];
  language: string;
}

export interface Invoice123InvoicePayment {
  id: string;
  date: string;
  /** "transfer" | "cash" | "refund" | "other" — cash payments come back as `false` (verified live). */
  type: string | false;
  total: string;
}

/** Shape of an invoice in GET /invoices (verified live). */
export interface Invoice123Invoice {
  id: string;
  date: string;
  date_due: string | null;
  type: string;
  issued_by: string | null;
  series_title: string;
  series_number: number;
  paid: boolean;
  total: string;
  currency: string | null;
  created_at: string;
  updated_at: string;
  client: {
    id?: string;
    client_id: string | null;
    name: string;
    address: string | null;
    code: string | null;
    vat_code: string | null;
    code_type?: string | null;
    country_code: string | null;
  } | null;
  products: {
    id?: string;
    unit_name: string | null;
    title: string;
    description: string | null;
    quantity: string;
    price: string;
    total: string;
  }[];
  payments: Invoice123InvoicePayment[];
  vats?: { vat: string; total: string }[];
}

// ---- payments ------------------------------------------------------------------

export type Invoice123PaymentType = "transfer" | "cash" | "refund" | "other";

export interface Invoice123PaymentCreatePayload {
  type: Invoice123PaymentType;
  total: string;
  date: string;
  mark_as_paid: boolean;
}

// ---- expenses (purchases) -------------------------------------------------------

export interface Invoice123ExpenseTypeOption {
  id: string;
  /** A line title it was used for, so the user can recognise it (the API exposes no names). */
  example: string;
  uses: number;
}

export interface Invoice123ExpenseSupplier {
  name: string;
  code: string | null;
  vat_code: string | null;
  code_type: Invoice123CodeType;
  address: string | null;
  country_code: string;
}

export interface Invoice123ExpenseProductPayload {
  title: string;
  price: string;
  quantity: string;
  /** Gross line total (net × (1 + VAT)). */
  total: string;
  /** VAT amount of the line. */
  total_vat: string;
  /**
   * Id of the tenant's VAT rate (GET /vats). Omitted for 0 %. NOT a bare
   * percentage: sending `vat: 21` was verified live to be misread
   * (stored as line total 21, VAT 0).
   */
  company_vat_id?: string;
  expense_type_id: string;
}

export interface Invoice123ExpenseCreatePayload {
  /** "vat-simple" — the only type verified on real data. */
  type: "vat-simple";
  /** The SUPPLIER's document number. */
  series: string;
  date: string;
  total: string;
  supplier: Invoice123ExpenseSupplier;
  products: Invoice123ExpenseProductPayload[];
}

/** Shape of an expense in GET /expenses (verified live). */
export interface Invoice123Expense {
  id: string;
  date: string;
  type: string;
  series: string;
  total: string;
  paid: boolean;
  supplier: { id: string; name: string; code: string | null; vat_code: string | null } | null;
  products: { title: string; expense_type_id: string; quantity: string; price: string; total: string; vat: string }[];
}
