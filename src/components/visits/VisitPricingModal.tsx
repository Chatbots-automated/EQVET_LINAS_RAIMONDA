"use client";

import { useEffect, useState } from "react";
import { BadgeEuro, Plus, Receipt, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { centsToNumber, centsToString, toCents } from "@/lib/money";
import { applyMarkup, lineCostCents, visitServiceLines } from "@/lib/visit-pricing";
import { findCatalogService, loadServiceCatalog, rememberServices, type CatalogService } from "@/lib/service-catalog";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];

interface ServiceRow {
  title: string;
  price: string;
}

interface ItemRow {
  id: string;
  name: string;
  qtyLabel: string;
  /** Purchase cost of the used quantity; null when the batch has no purchase price. */
  costCents: number | null;
  markup: string;
  sale: string;
}

const CELL_INPUT = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

function parsePercent(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function initialServices(visit: Visit): ServiceRow[] {
  const rows = visitServiceLines(visit).map((s) => ({
    title: s.title,
    price: s.price != null ? centsToString(toCents(s.price) ?? 0) : "",
  }));
  return rows.length ? rows : [{ title: "", price: "" }];
}

function initialItems(visit: Visit): ItemRow[] {
  return visit.products_used.map((p) => {
    const costCents = lineCostCents(p);
    const saleCents =
      p.sale_total != null ? toCents(p.sale_total) : costCents != null ? applyMarkup(costCents, p.markup_percent ?? 0) : null;
    return {
      id: p.usage_item_id,
      name: p.product_name,
      qtyLabel: formatQty(p.quantity, p.unit),
      costCents,
      markup: p.markup_percent != null ? String(p.markup_percent) : costCents != null ? "0" : "",
      sale: saleCents != null ? centsToString(saleCents) : "",
    };
  });
}

/**
 * "Vizito užbaigimas": pops up when a visit is finished. Shows every product
 * used with its purchase cost, lets the vet set the antkainis (%) per product
 * and a price per service, and saves it all on the visit — the same numbers
 * then pre-fill the invoice.
 *
 * Mount it only while open (`{visit && <VisitPricingModal ... />}`) so the
 * form always starts from the visit's current data.
 */
export function VisitPricingModal({
  visit,
  onClose,
  onSaved,
}: {
  visit: Visit;
  onClose: () => void;
  /** `thenInvoice` — the vet chose "save and issue an invoice". */
  onSaved: (updated: Visit, thenInvoice: boolean) => void;
}) {
  const [services, setServices] = useState<ServiceRow[]>(() => initialServices(visit));
  const [items, setItems] = useState<ItemRow[]>(() => initialItems(visit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [remember, setRemember] = useState(true);

  // Saved services: once the list arrives, services that have no price yet get their saved one.
  useEffect(() => {
    let cancelled = false;
    loadServiceCatalog(createClient()).then((list) => {
      if (cancelled) return;
      setCatalog(list);
      setServices((prev) =>
        prev.map((s) => {
          const saved = findCatalogService(list, s.title);
          return !s.price.trim() && saved?.price != null ? { ...s, price: centsToString(toCents(saved.price) ?? 0) } : s;
        })
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function setService(index: number, patch: Partial<ServiceRow>) {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  /** Adds a saved service with its price (into the empty row, if that is all there is). */
  function addFromCatalog(id: string) {
    const saved = catalog.find((c) => c.id === id);
    if (!saved) return;
    const row = { title: saved.name, price: saved.price != null ? centsToString(toCents(saved.price) ?? 0) : "" };
    setServices((prev) => [...prev.filter((s) => s.title.trim() || s.price.trim()), row]);
  }

  /** Typing a saved service's name brings its price along. */
  function setServiceTitle(index: number, title: string) {
    const saved = findCatalogService(catalog, title);
    const current = services[index];
    setService(index, saved?.price != null && !current.price.trim() ? { title, price: centsToString(toCents(saved.price) ?? 0) } : { title });
  }

  function setMarkup(index: number, markup: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const pct = parsePercent(markup);
        const sale = it.costCents != null && pct != null ? centsToString(applyMarkup(it.costCents, pct)) : it.sale;
        return { ...it, markup, sale };
      })
    );
  }

  function setSale(index: number, sale: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const saleCents = toCents(sale);
        // Typing the final price works backwards to the antkainis.
        const markup =
          it.costCents && saleCents != null && saleCents >= it.costCents
            ? String(Math.round((saleCents / it.costCents - 1) * 10000) / 100)
            : it.markup;
        return { ...it, sale, markup };
      })
    );
  }

  const servicesCents = services.reduce((sum, s) => sum + (toCents(s.price) ?? 0), 0);
  const itemsCents = items.reduce((sum, it) => sum + (toCents(it.sale) ?? 0), 0);
  const costCents = items.reduce((sum, it) => sum + (it.costCents ?? 0), 0);

  async function save(thenInvoice: boolean) {
    setError(null);

    const cleanServices = services.filter((s) => s.title.trim() || s.price.trim());
    for (const s of cleanServices) {
      if (!s.title.trim()) return setError("Įveskite paslaugos pavadinimą.");
      if (s.price.trim() && (toCents(s.price) === null || toCents(s.price)! < 0)) {
        return setError(`Neteisinga paslaugos „${s.title}“ kaina.`);
      }
    }
    for (const it of items) {
      if (it.markup.trim() && parsePercent(it.markup) === null) return setError(`Neteisingas „${it.name}“ antkainis.`);
      if (it.sale.trim() && (toCents(it.sale) === null || toCents(it.sale)! < 0)) return setError(`Neteisinga „${it.name}“ kaina.`);
    }

    setSaving(true);
    const supabase = createClient();
    const pricedServices = cleanServices.map((s) => {
      const cents = toCents(s.price);
      return { title: s.title.trim(), price: cents === null ? null : centsToNumber(cents) };
    });
    const { error: saveError } = await supabase.rpc("save_visit_pricing", {
      p_visit_id: visit.visit_id,
      p_services: pricedServices,
      p_items: items.map((it) => {
        const cents = toCents(it.sale);
        return { id: it.id, markup_percent: parsePercent(it.markup), sale_total: cents === null ? null : centsToNumber(cents) };
      }),
      p_complete: true,
    });
    if (saveError) {
      setSaving(false);
      return setError(saveError.message);
    }
    if (remember) await rememberServices(supabase, catalog, pricedServices);

    const { data: updated, error: loadError } = await supabase
      .from("visit_history_view")
      .select("*")
      .eq("visit_id", visit.visit_id)
      .single();
    setSaving(false);
    if (loadError || !updated) return setError(loadError?.message ?? "Nepavyko įkelti vizito.");
    onSaved(updated, thenInvoice);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Vizito užbaigimas · ${visit.animal_tag ?? "—"} · ${formatDate(visit.visit_date)}`}
      icon={<BadgeEuro size={18} />}
      iconClassName="bg-amber-50 text-amber-700"
      wide
    >
      <div className="space-y-5">
        {visit.client_name && (
          <p className="text-sm text-slate-600">
            Klientas: <span className="font-medium text-slate-900">{visit.client_name}</span>
          </p>
        )}

        <section>
          <div className="mb-2 grid grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <div className="col-span-8">Paslauga</div>
            <div className="col-span-4">Kaina, €</div>
          </div>
          <div className="space-y-2">
            {services.map((s, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <input
                  className={`col-span-8 ${CELL_INPUT}`}
                  placeholder="Pvz. Gydymas"
                  list="pricing-service-catalog"
                  value={s.title}
                  disabled={saving}
                  onChange={(e) => setServiceTitle(i, e.target.value)}
                />
                <input
                  className={`col-span-3 ${CELL_INPUT}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={s.price}
                  disabled={saving}
                  onChange={(e) => setService(i, { price: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                  disabled={saving}
                  aria-label="Pašalinti paslaugą"
                  className="col-span-1 flex justify-center rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <datalist id="pricing-service-catalog">
            {catalog.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value=""
              disabled={saving || catalog.length === 0}
              onChange={(e) => addFromCatalog(e.target.value)}
              aria-label="Pasirinkti paslaugą iš sąrašo"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 disabled:text-slate-400"
            >
              <option value="">{catalog.length ? "Pasirinkti paslaugą iš sąrašo…" : "Paslaugų sąrašas tuščias"}</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.price != null ? ` — ${formatMoney(c.price)}` : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setServices((prev) => [...prev, { title: "", price: "" }])}
            >
              <Plus size={14} /> Nauja paslauga
            </Button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={remember}
              disabled={saving}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Įsiminti šias paslaugas ir kainas sąraše (kitą kartą pasirinksite iš sąrašo)
          </label>
        </section>

        <section>
          <div className="mb-2 text-sm font-medium text-slate-700">Vaistai ir priemonės</div>
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">Šiame vizite produktai nenurašyti.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Produktas</th>
                    <th className="px-3 py-2 text-right">Pirkimo kaina</th>
                    <th className="w-24 px-3 py-2">Antkainis, %</th>
                    <th className="w-28 px-3 py-2">Kaina klientui, €</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, i) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{it.name}</div>
                        <div className="text-xs text-slate-500">{it.qtyLabel}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {it.costCents != null ? (
                          formatMoney(centsToNumber(it.costCents))
                        ) : (
                          <span className="text-xs text-slate-400">nenurodyta pajamuojant</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className={CELL_INPUT}
                          inputMode="decimal"
                          placeholder="0"
                          value={it.markup}
                          disabled={saving || it.costCents == null}
                          onChange={(e) => setMarkup(i, e.target.value)}
                          aria-label={`${it.name} antkainis`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className={CELL_INPUT}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={it.sale}
                          disabled={saving}
                          onChange={(e) => setSale(i, e.target.value)}
                          aria-label={`${it.name} kaina klientui`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length > 0 && (
            <p className="mt-1.5 text-xs text-slate-500">
              Antkainis įsimenamas produktui — kitą kartą bus pasiūlytas automatiškai.
            </p>
          )}
        </section>

        <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Paslaugos</dt>
            <dd>{formatMoney(centsToNumber(servicesCents))}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>
              Vaistai ir priemonės
              {costCents > 0 && <span className="ml-1 text-xs text-slate-400">(pirkimo kaina {formatMoney(centsToNumber(costCents))})</span>}
            </dt>
            <dd>{formatMoney(centsToNumber(itemsCents))}</dd>
          </div>
          <div className="flex justify-between pt-1 text-lg font-bold text-slate-900">
            <dt>Iš viso</dt>
            <dd>{formatMoney(centsToNumber(servicesCents + itemsCents))}</dd>
          </div>
        </dl>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Vėliau
          </Button>
          <Button type="button" variant="secondary" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saugoma..." : "Išsaugoti kainas"}
          </Button>
          <Button
            type="button"
            onClick={() => save(true)}
            disabled={saving || !visit.client_id}
            title={visit.client_id ? undefined : "Gyvūnas nepriskirtas klientui"}
          >
            <Receipt size={16} /> Išsaugoti ir išrašyti sąskaitą
          </Button>
        </div>
      </div>
    </Modal>
  );
}
