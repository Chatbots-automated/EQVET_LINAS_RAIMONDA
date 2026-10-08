"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, Unit } from "@/lib/database.types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DateInput, Input, SearchSelect, Select } from "@/components/ui/Field";
import { UNIT_LABELS } from "@/lib/labels";
import { formatQty } from "@/lib/format";
import { centsToNumber, lineTotalCents, toCents, toMilli } from "@/lib/money";

type Purchase = Database["public"]["Tables"]["invoices"]["Row"];
type Product = Database["public"]["Tables"]["products"]["Row"];
type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];

const UNITS = Object.keys(UNIT_LABELS) as Unit[];

interface Line {
  id: string;
  /** Set when the line was received into stock (a batch exists). */
  batchId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  vatRate: string;
  productId: string;
  unit: Unit | "";
  lot: string;
  expiry: string;
  packageCount: string;
  /** Quantity already written off (nurašyta) from this batch. */
  used: number;
  remove: boolean;
}

interface Header {
  number: string;
  date: string;
  supplierId: string;
  net: string;
  vat: string;
  gross: string;
}

const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** Net of one line in cents: the stated line total, else quantity × unit price. */
function lineNetCents(l: Line): number | null {
  const total = toCents(l.totalPrice);
  if (total !== null) return total;
  const q = toMilli(l.quantity);
  const p = toCents(l.unitPrice);
  return q !== null && p !== null ? lineTotalCents(q, p) : null;
}

/** Document totals from the lines, or null if any line lacks a net or VAT rate (then the totals are typed by hand). */
function totalsFromLines(lines: Line[]): Pick<Header, "net" | "vat" | "gross"> | null {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const n = lineNetCents(l);
    const rate = num(l.vatRate);
    if (n === null || rate === null || !Number.isFinite(rate)) return null;
    net += n;
    vat += Math.floor((n * rate + 50) / 100);
  }
  return {
    net: String(centsToNumber(net)),
    vat: String(centsToNumber(vat)),
    gross: String(centsToNumber(net + vat)),
  };
}

function must<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message);
  return res;
}

/** Edit a received supplier invoice: header, lines, and (for stocked lines) the batch they created. */
export function EditPurchaseModal({
  purchase,
  onClose,
  onSaved,
}: {
  purchase: Purchase | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchase) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    setHeader(null);
    setLines([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      const supabase = createClient();
      const [{ data: p }, { data: s }, { data: items }, { data: batches }] = await Promise.all([
        supabase.from("products").select("*").order("name"),
        supabase.from("suppliers").select("*").order("name"),
        supabase.from("invoice_items").select("*").eq("invoice_id", purchase.id).order("created_at"),
        supabase.from("batches").select("*").eq("invoice_id", purchase.id),
      ]);
      if (cancelled) return;
      const batchById = new Map((batches ?? []).map((b) => [b.id, b]));
      setProducts(p ?? []);
      setSuppliers(s ?? []);
      setHeader({
        number: purchase.invoice_number ?? "",
        date: purchase.invoice_date ?? "",
        supplierId: purchase.supplier_id ?? "",
        net: text(purchase.total_net),
        vat: text(purchase.total_vat),
        gross: text(purchase.total_gross),
      });
      setLines(
        (items ?? []).map((it) => {
          const b = it.batch_id ? batchById.get(it.batch_id) : undefined;
          return {
            id: it.id,
            batchId: b?.id ?? null,
            description: it.description ?? "",
            quantity: text(b ? b.received_qty : it.quantity),
            unitPrice: text(it.unit_price),
            totalPrice: text(it.total_price),
            vatRate: text(it.vat_rate),
            productId: b?.product_id ?? "",
            unit: b?.unit ?? "",
            lot: b?.lot ?? "",
            expiry: b?.expiry_date ?? "",
            packageCount: text(b?.package_count),
            used: b ? b.received_qty - (b.qty_left ?? b.received_qty) : 0,
            remove: false,
          };
        })
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [purchase]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name, hint: p.is_active ? undefined : "neaktyvus" })),
    [products]
  );

  /** Edit a line; when money/VAT/quantity changed, keep the document totals in step with the lines. */
  function updateLine(id: string, patch: Partial<Line>) {
    const next = lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    setLines(next);
    if (header && ("quantity" in patch || "unitPrice" in patch || "totalPrice" in patch || "vatRate" in patch || "remove" in patch)) {
      const totals = totalsFromLines(next.filter((l) => !l.remove));
      if (totals) setHeader({ ...header, ...totals });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!purchase || !header) return;
    setError(null);

    const kept = lines.filter((l) => !l.remove);
    for (const l of kept) {
      const label = l.description.trim() || "Eilutė";
      if (!l.description.trim()) return setError("Kiekvienai eilutei įveskite pavadinimą.");
      const qty = num(l.quantity);
      if (qty === null || !Number.isFinite(qty) || qty < 0) return setError(`„${label}“: įveskite kiekį.`);
      if (l.batchId) {
        if (!l.productId) return setError(`„${label}“: pasirinkite produktą.`);
        if (!(qty > 0)) return setError(`„${label}“: kiekis turi būti didesnis už 0.`);
        if (qty < l.used) return setError(`„${label}“: kiekis negali būti mažesnis už jau panaudotą (${formatQty(l.used, l.unit)}).`);
      }
      if (l.totalPrice.trim() && toCents(l.totalPrice) === null) return setError(`„${label}“: neteisinga suma be PVM.`);
      if (l.unitPrice.trim() && toCents(l.unitPrice) === null) return setError(`„${label}“: neteisinga vieneto kaina.`);
      const rate = num(l.vatRate);
      if (rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 100)) return setError(`„${label}“: PVM tarifas turi būti sveikas skaičius, pvz. 21.`);
    }
    for (const [label, value] of [["suma be PVM", header.net], ["PVM suma", header.vat], ["suma su PVM", header.gross]] as const) {
      if (value.trim() && toCents(value) === null) return setError(`Neteisinga dokumento ${label}.`);
    }

    const supabase = createClient();
    setSaving(true);
    try {
      // 1. removed lines (a stocked line takes its batch out of stock; the DB refuses if it was already used)
      for (const l of lines.filter((l) => l.remove)) {
        if (l.batchId) must(await supabase.from("batches").delete().eq("id", l.batchId));
        must(await supabase.from("invoice_items").delete().eq("id", l.id));
      }

      // 2. remaining lines + their batches
      const supplier = suppliers.find((s) => s.id === header.supplierId);
      for (const l of kept) {
        const qty = Number(num(l.quantity));
        const totalCents = toCents(l.totalPrice);
        const unitCents = toCents(l.unitPrice);
        const rate = num(l.vatRate);

        if (l.batchId) {
          const net = lineNetCents(l);
          must(
            await supabase
              .from("batches")
              .update({
                product_id: l.productId,
                unit: l.unit as Unit,
                received_qty: qty,
                lot: l.lot.trim() || null,
                expiry_date: l.expiry || null,
                package_count: num(l.packageCount),
                purchase_price: net === null ? null : centsToNumber(net),
                doc_number: header.number.trim() || null,
                doc_date: header.date || null,
                ...(supplier ? { supplier_id: supplier.id } : {}),
              })
              .eq("id", l.batchId)
          );
        }

        must(
          await supabase
            .from("invoice_items")
            .update({
              description: l.description.trim(),
              quantity: qty,
              unit_price: unitCents === null ? null : centsToNumber(unitCents),
              total_price: totalCents === null ? null : centsToNumber(totalCents),
              vat_rate: rate,
            })
            .eq("id", l.id)
        );
      }

      // 3. document header (totals typed or derived above)
      const cents = (s: string) => {
        const c = toCents(s);
        return c === null ? null : centsToNumber(c);
      };
      must(
        await supabase
          .from("invoices")
          .update({
            invoice_number: header.number.trim() || null,
            invoice_date: header.date || null,
            total_net: cents(header.net),
            total_vat: cents(header.vat),
            total_gross: cents(header.gross),
            ...(supplier && supplier.id !== purchase.supplier_id
              ? { supplier_id: supplier.id, supplier_name: supplier.name, supplier_code: supplier.code, supplier_vat: supplier.vat_code }
              : {}),
          })
          .eq("id", purchase.id)
      );

      onSaved();
      onClose();
    } catch (err) {
      // Every step is a plain overwrite, so saving again is safe.
      setError(`${err instanceof Error ? err.message : "Nepavyko išsaugoti."} Dalis pakeitimų galėjo būti jau išsaugota — pataisykite ir išsaugokite dar kartą.`);
    } finally {
      setSaving(false);
    }
  }

  const status = purchase?.invoice123_sync_status;
  const locked = status === "sending";
  const removedCount = lines.filter((l) => l.remove).length;

  return (
    <Modal
      open={!!purchase}
      onClose={onClose}
      title={`Redaguoti sąskaitą${purchase?.invoice_number ? ` ${purchase.invoice_number}` : ""}`}
      icon={<Pencil size={18} />}
      iconClassName="bg-amber-50 text-amber-600"
      xwide
    >
      {loading || !header ? (
        <p className="text-sm text-slate-500">Kraunama...</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          {locked && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Dokumentas šiuo metu siunčiamas į Sąskaita123 — redaguoti galėsite, kai siuntimas baigsis.
            </p>
          )}
          {(status === "sent" || status === "needs_reconcile") && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Šis dokumentas jau išsiųstas į Sąskaita123. Pakeitimai bus išsaugoti tik čia (atsargos ir žurnalai) —
              Sąskaita123 pirkimo įrašo jie neatnaujins, jį pataisykite ten atskirai.
            </p>
          )}
          {purchase?.saved_to_gvet === false && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Dokumentas užregistruotas tik Sąskaita123 — prekės nepajamuotos, todėl keičiami tik dokumento duomenys.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Dokumento Nr." value={header.number} onChange={(e) => setHeader({ ...header, number: e.target.value })} />
            <DateInput label="Data" value={header.date} onChange={(iso) => setHeader({ ...header, date: iso })} />
            <div>
              <Select label="Tiekėjas" value={header.supplierId} onChange={(e) => setHeader({ ...header, supplierId: e.target.value })}>
                <option value="">{purchase?.supplier_id ? "—" : (purchase?.supplier_name ?? "—")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Prekės ({lines.length - removedCount})</h4>
            {lines.length === 0 && <p className="text-sm text-slate-500">Dokumente eilučių nėra.</p>}

            {lines.map((l) => {
              const stocked = !!l.batchId;
              const isUsed = l.used > 0;
              return (
                <div
                  key={l.id}
                  className={`rounded-lg border p-3 ${l.remove ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className={`text-sm font-medium ${l.remove ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {l.description || "Eilutė be pavadinimo"}
                    </p>
                    {l.remove ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => updateLine(l.id, { remove: false })}>
                        <Undo2 size={14} /> Atstatyti
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isUsed}
                        title={isUsed ? "Prekė jau panaudota (nurašyta) — pašalinti negalima" : undefined}
                        onClick={() => updateLine(l.id, { remove: true })}
                      >
                        <Trash2 size={14} /> Pašalinti eilutę
                      </Button>
                    )}
                  </div>

                  {!l.remove && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input label="Pavadinimas sąskaitoje" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} />
                        {stocked && (
                          <SearchSelect
                            label="Produktas (atsargose)"
                            required
                            disabled={isUsed}
                            options={productOptions}
                            value={l.productId}
                            onChange={(productId) => {
                              const product = products.find((p) => p.id === productId);
                              updateLine(l.id, { productId, ...(product ? { unit: product.unit } : {}) });
                            }}
                          />
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <Input
                          label="Kiekis"
                          type="number"
                          step="any"
                          min={l.used || 0}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                        />
                        {stocked && (
                          <Select
                            label="Matas"
                            disabled={isUsed}
                            value={l.unit}
                            onChange={(e) => updateLine(l.id, { unit: e.target.value as Unit })}
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {UNIT_LABELS[u]}
                              </option>
                            ))}
                          </Select>
                        )}
                        <Input label="Vieneto kaina" type="number" step="0.01" value={l.unitPrice} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })} />
                        <Input label="Viso be PVM" type="number" step="0.01" value={l.totalPrice} onChange={(e) => updateLine(l.id, { totalPrice: e.target.value })} />
                        <Input label="PVM %" type="number" step="1" min={0} max={100} value={l.vatRate} onChange={(e) => updateLine(l.id, { vatRate: e.target.value })} />
                        {stocked && (
                          <Input label="Pakuočių sk." type="number" step="any" value={l.packageCount} onChange={(e) => updateLine(l.id, { packageCount: e.target.value })} />
                        )}
                      </div>

                      {stocked && (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <Input label="Partija (serija)" value={l.lot} onChange={(e) => updateLine(l.id, { lot: e.target.value })} />
                          <DateInput label="Galioja iki" value={l.expiry} onChange={(iso) => updateLine(l.id, { expiry: iso })} />
                        </div>
                      )}

                      {isUsed && (
                        <p className="text-xs text-amber-700">
                          Jau panaudota {formatQty(l.used, l.unit)}: produkto ir mato vieneto keisti bei eilutės šalinti nebegalima,
                          o kiekis negali būti mažesnis už panaudotą.
                        </p>
                      )}
                    </div>
                  )}
                  {l.remove && stocked && (
                    <p className="text-xs text-red-700">Išsaugojus, ši prekė bus pašalinta ir iš atsargų bei žurnalų.</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Viso be PVM" type="number" step="0.01" value={header.net} onChange={(e) => setHeader({ ...header, net: e.target.value })} />
            <Input label="PVM suma" type="number" step="0.01" value={header.vat} onChange={(e) => setHeader({ ...header, vat: e.target.value })} />
            <Input label="Viso su PVM" type="number" step="0.01" value={header.gross} onChange={(e) => setHeader({ ...header, gross: e.target.value })} />
          </div>
          <p className="-mt-3 text-xs text-slate-500">Sumos perskaičiuojamos keičiant eilutes; jei eilutėse trūksta sumos ar PVM, įveskite jas patys.</p>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving || locked}>
              {saving ? "Saugoma..." : "Išsaugoti pakeitimus"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
