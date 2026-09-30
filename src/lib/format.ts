const pad = (n: number) => String(n).padStart(2, "0");
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date → "YYYY-MM-DD" in LOCAL time (toISOString() would shift to UTC and can land on the previous day). */
export function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

/** Dates are shown and entered as DD/MM/YYYY everywhere in the app. */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const m = ISO_DATE_RE.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(toISODate(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" for a date input's text ("" when empty/invalid). */
export function isoToDateText(iso: string | null | undefined) {
  const m = iso ? ISO_DATE_RE.exec(iso.slice(0, 10)) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "DD/MM/YYYY" → "YYYY-MM-DD", or "" unless it is a complete, real calendar date. */
export function dateTextToISO(text: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return "";
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day || year < 1900) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
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
