import type { Database } from "@/lib/database.types";
import type { DraftLine } from "@/components/invoices/InvoiceDraftModal";
import { formatQty } from "@/lib/format";
import { centsToString, lineTotalCents, toCents, toMilli } from "@/lib/money";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
export type VisitProduct = Visit["products_used"][number];

/** Service titles typed as free text ("Gydymas, apžiūra") → one entry per service. */
export function splitServices(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Services of a visit with prices: saved lines if the visit was priced, else derived from the text. */
export function visitServiceLines(visit: Visit): { title: string; price: number | null }[] {
  if (visit.service_lines.length > 0) return visit.service_lines.map((s) => ({ title: s.title, price: s.price }));
  const titles = splitServices(visit.services);
  if (titles.length === 0 && visit.service_price != null) return [{ title: "Veterinarinės paslaugos", price: visit.service_price }];
  // An old single price belongs to the visit as a whole — only reuse it when there is exactly one service.
  return titles.map((title) => ({ title, price: titles.length === 1 ? visit.service_price : null }));
}

/** Purchase cost of a used product line in cents (null when the batch had no purchase price). */
export function lineCostCents(p: Pick<VisitProduct, "unit_cost" | "quantity">): number | null {
  if (p.unit_cost == null) return null;
  return Math.round(p.unit_cost * p.quantity * 100);
}

/** cost + antkainis % → selling price, in cents. */
export function applyMarkup(costCents: number, markupPercent: number): number {
  return Math.round(costCents * (1 + markupPercent / 100));
}

/**
 * Invoice draft lines for a visit: every service with its price, then every
 * product with its selling price. A product is billed as qty × unit price
 * when that reproduces the selling price to the cent; otherwise as one line
 * ("Vaistas (50 ml)" × 1) so the invoice total always equals the visit total.
 */
export function visitInvoiceLines(visit: Visit): DraftLine[] {
  const lines: DraftLine[] = visitServiceLines(visit).map((s) => ({
    title: s.title,
    quantity: "1",
    unitPrice: s.price != null ? centsToString(toCents(s.price) ?? 0) : "",
  }));

  const hasPricedService = lines.some((l) => (toCents(l.unitPrice) ?? 0) > 0);

  for (const p of visit.products_used) {
    const saleCents = toCents(p.sale_total);
    // Priced 0 next to a priced service = included in it (e.g. a herd price): no line of its own.
    if (saleCents === 0 && hasPricedService) continue;
    const qtyMilli = toMilli(p.quantity);
    if (saleCents === null) {
      lines.push({ title: p.product_name, quantity: String(p.quantity), unitPrice: "", productId: p.product_id });
      continue;
    }
    const unitCents = Math.round(saleCents / p.quantity);
    if (qtyMilli !== null && qtyMilli > 0 && lineTotalCents(qtyMilli, unitCents) === saleCents) {
      lines.push({ title: p.product_name, quantity: String(p.quantity), unitPrice: centsToString(unitCents), productId: p.product_id });
    } else {
      lines.push({
        title: `${p.product_name} (${formatQty(p.quantity, p.unit)})`,
        quantity: "1",
        unitPrice: centsToString(saleCents),
        productId: p.product_id,
      });
    }
  }
  return lines;
}
