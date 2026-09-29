import type { BatchStatus, PaymentStatus, PaymentType, ProductCategory, SalesInvoiceStatus, StockStatus, Unit } from "@/lib/database.types";

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  medicines: "Vaistai",
  vaccines: "Vakcinos",
  biocides: "Biocidai",
  materials: "Priemonės",
  hygiene: "Higiena",
  other: "Kita",
};

export const UNIT_LABELS: Record<Unit, string> = {
  ml: "ml",
  l: "l",
  g: "g",
  kg: "kg",
  vnt: "vnt.",
  "tabletkė": "tabl.",
  "dozė": "dozė",
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  available: "Pakankamai",
  low: "Mažai",
  depleted: "Išnaudota",
  expired: "Pasibaigęs galiojimas",
};

export const STOCK_STATUS_COLORS: Record<StockStatus, string> = {
  available: "bg-emerald-50 text-emerald-700",
  low: "bg-amber-50 text-amber-700",
  depleted: "bg-slate-100 text-slate-600",
  expired: "bg-red-50 text-red-700",
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  active: "Aktyvi",
  depleted: "Išnaudota",
  expired: "Pasibaigusi",
};

export const SPECIES_OPTIONS = [
  { value: "dog", label: "Šuo" },
  { value: "cat", label: "Katė" },
  { value: "equine", label: "Arklys" },
  { value: "bovine", label: "Galvijas" },
];

export function speciesLabel(value: string | null | undefined) {
  if (!value) return "—";
  return SPECIES_OPTIONS.find((s) => s.value === value)?.label ?? value;
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Neapmokėta",
  partial: "Dalinai apmokėta",
  paid: "Apmokėta",
  overpaid: "Permokėta",
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  unpaid: "bg-amber-50 text-amber-700",
  partial: "bg-sky-50 text-sky-700",
  paid: "bg-emerald-50 text-emerald-700",
  overpaid: "bg-violet-50 text-violet-700",
};

export const INVOICE_STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  creating: "Kuriama",
  created: "Išrašyta",
  failed: "Nepavyko",
  needs_reconcile: "Reikia patikrinti",
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  transfer: "Banko pavedimas",
  cash: "Grynais",
  other: "Kita",
  refund: "Grąžinimas",
};
