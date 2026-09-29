// Exact decimal handling for invoices. Never do money math on JS floats
// (0.1 + 0.2 !== 0.3): amounts are parsed from their decimal string into
// scaled integers, combined with integer arithmetic, and formatted back.
//
//   cents     — money, scale 2   ("61.00"   → 6100)
//   milli     — quantities, scale 3 ("1.5" → 1500)
//
// Invoice123 returns money as strings with 4–6 decimals ("494.0000",
// "70.000000"); parseScaled rounds those half-up to the requested scale.

const DECIMAL_RE = /^([+-])?(\d+)(?:[.,](\d+))?$/;

/** "12,345" | "12.345" | 12.345 → integer at `scale` decimals (half-up), or null if not a number. */
export function parseScaled(value: string | number | null | undefined, scale: number): number | null {
  if (value === null || value === undefined) return null;
  const str = typeof value === "number" ? numberToPlainString(value) : value.trim();
  const m = DECIMAL_RE.exec(str);
  if (!m) return null;
  const [, sign, intPart, fracRaw = ""] = m;
  const frac = fracRaw.padEnd(scale + 1, "0");
  let n = Number(intPart) * 10 ** scale + Number(frac.slice(0, scale) || "0");
  if (Number(frac[scale]) >= 5) n += 1; // half-up on the first dropped digit
  if (!Number.isSafeInteger(n)) return null;
  return sign === "-" && n !== 0 ? -n : n;
}

export const toCents = (v: string | number | null | undefined) => parseScaled(v, 2);
export const toMilli = (v: string | number | null | undefined) => parseScaled(v, 3);

/** 6100 → "61.00" — the string format Invoice123 expects. */
export function formatScaled(n: number, scale: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const int = Math.floor(abs / 10 ** scale);
  const frac = String(abs % 10 ** scale).padStart(scale, "0");
  return `${neg ? "-" : ""}${int}${scale > 0 ? `.${frac}` : ""}`;
}

export const centsToString = (c: number) => formatScaled(c, 2);
export const milliToString = (m: number) => formatScaled(m, 3).replace(/\.?0+$/, "");

/** For numeric DB columns: cents → number with exactly 2 decimals of meaning. */
export const centsToNumber = (c: number) => Number(centsToString(c));

/** quantity (milli) × unit price (cents) → line total in cents, rounded half-up. */
export function lineTotalCents(qtyMilli: number, priceCents: number): number {
  const product = qtyMilli * priceCents; // scale 5
  if (!Number.isSafeInteger(product)) throw new Error("Amount too large");
  const sign = product < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(product) + 500) / 1000);
}

function numberToPlainString(n: number): string {
  // Avoid exponent notation (1e-7) for tiny/huge floats coming from numeric columns.
  return Number.isInteger(n) ? String(n) : n.toFixed(6);
}
