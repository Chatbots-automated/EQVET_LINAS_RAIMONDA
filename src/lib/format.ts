export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("lt-LT");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("lt-LT");
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("lt-LT", { style: "currency", currency: "EUR" }).format(value);
}

export function formatQty(value: number | null | undefined, unit?: string) {
  if (value === null || value === undefined) return "—";
  const num = new Intl.NumberFormat("lt-LT", { maximumFractionDigits: 2 }).format(value);
  return unit ? `${num} ${unit}` : num;
}

export function toDateInputValue(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}
