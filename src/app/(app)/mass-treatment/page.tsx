"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Plus, Syringe, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DateInput, Input, SearchSelect, Select } from "@/components/ui/Field";
import { CATEGORY_LABELS, speciesLabel } from "@/lib/labels";
import { formatDate, formatMoney, formatQty, todayISO } from "@/lib/format";
import { centsToNumber, toCents } from "@/lib/money";
import { useProfileName } from "@/lib/profile";

type Animal = Database["public"]["Tables"]["animals"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type Product = Database["public"]["Tables"]["products"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];

interface Line {
  key: number;
  productId: string;
  /** "" = automatic: oldest expiry first, across batches. */
  batchId: string;
  /** Per animal. */
  qty: string;
}

const NO_CLIENT = "__none__";
const ALL_HERDS = "__all__";
const NO_HERD = "__noherd__";

let lineKey = 0;
const emptyLine = (): Line => ({ key: ++lineKey, productId: "", batchId: "", qty: "" });

export default function MassTreatmentPage() {
  const supabase = createClient();
  const profileName = useProfileName();

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayISO());
  const [vet, setVet] = useState<string | null>(null); // null = not typed yet → the signed-in person
  const [reason, setReason] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [herdPrice, setHerdPrice] = useState("");

  const [clientId, setClientId] = useState("");
  const [herd, setHerd] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ animals: number; products: number } | null>(null);

  async function load() {
    const [{ data: a }, { data: c }, { data: p }, { data: b }] = await Promise.all([
      supabase.from("animals").select("*").eq("active", true).order("tag_no"),
      supabase.from("clients").select("*").order("name"),
      supabase.from("products").select("*").eq("is_active", true).order("name"),
      supabase.from("stock_by_batch").select("*").gt("qty_left", 0).neq("stock_status", "expired").order("expiry_date", { nullsFirst: false }),
    ]);
    setAnimals(a ?? []);
    setClients(c ?? []);
    setProducts(p ?? []);
    setBatches(b ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- clients / herds ----------------------------------------------------------

  const clientOptions = useMemo(() => {
    const withAnimals = new Set(animals.map((a) => a.client_id ?? NO_CLIENT));
    const list = clients.filter((c) => withAnimals.has(c.id)).map((c) => ({ value: c.id, label: c.name }));
    if (withAnimals.has(NO_CLIENT)) list.push({ value: NO_CLIENT, label: "— Klientas nenurodytas —" });
    return list;
  }, [animals, clients]);

  const clientAnimals = useMemo(
    () => (clientId ? animals.filter((a) => (a.client_id ?? NO_CLIENT) === clientId) : []),
    [animals, clientId]
  );

  const herdOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let noHerd = 0;
    for (const a of clientAnimals) {
      const h = a.herd_no?.trim();
      if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
      else noHerd += 1;
    }
    const list = [...counts.entries()]
      .sort(([x], [y]) => x.localeCompare(y, "lt", { numeric: true }))
      .map(([h, n]) => ({ value: h, label: `Banda ${h} (${n} gyv.)` }));
    if (noHerd) list.push({ value: NO_HERD, label: `Be bandos numerio (${noHerd} gyv.)` });
    return list;
  }, [clientAnimals]);

  function animalsOfHerd(h: string, pool: Animal[]) {
    if (h === ALL_HERDS) return pool;
    if (h === NO_HERD) return pool.filter((a) => !a.herd_no?.trim());
    return pool.filter((a) => a.herd_no?.trim() === h);
  }

  const herdAnimals = useMemo(() => (herd ? animalsOfHerd(herd, clientAnimals) : []), [herd, clientAnimals]);

  function chooseClient(id: string) {
    setClientId(id);
    setHerd("");
    setSelected(new Set());
  }

  function chooseHerd(h: string) {
    setHerd(h);
    // Everyone in the herd is treated unless unticked below.
    setSelected(new Set(h ? animalsOfHerd(h, clientAnimals).map((a) => a.id) : []));
  }

  function toggleAnimal(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- products ------------------------------------------------------------------

  const stockedProductIds = useMemo(() => new Set(batches.map((b) => b.product_id)), [batches]);

  /** Any product with stock, listed under its category (products come name-sorted; categories keep their usual order). */
  function productOptionsFor(line: Line) {
    const taken = new Set(lines.filter((l) => l.key !== line.key).map((l) => l.productId));
    const order = Object.keys(CATEGORY_LABELS);
    return products
      .filter((p) => stockedProductIds.has(p.id) && !taken.has(p.id))
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
      .map((p) => {
        const left = batches.filter((b) => b.product_id === p.id && b.unit === p.unit).reduce((sum, b) => sum + (b.qty_left ?? 0), 0);
        return { value: p.id, label: p.name, hint: `liko ${formatQty(left, p.unit)}`, group: CATEGORY_LABELS[p.category] };
      });
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Stock the line can draw from, in the product's own unit. */
  function availableFor(line: Line) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return 0;
    const own = batches.filter((b) => b.product_id === product.id && b.unit === product.unit);
    if (line.batchId) return own.find((b) => b.batch_id === line.batchId)?.qty_left ?? 0;
    return own.reduce((sum, b) => sum + (b.qty_left ?? 0), 0);
  }

  const animalCount = selected.size;
  const activeLines = lines.filter((l) => l.productId && Number(l.qty) > 0);

  const derivedReason = useMemo(() => {
    const categories = activeLines.map((l) => products.find((p) => p.id === l.productId)?.category);
    const vaccines = categories.filter((c) => c === "vaccines").length;
    if (categories.length && vaccines === categories.length) return "Masinė vakcinacija";
    if (vaccines > 0) return "Masinis gydymas / vakcinacija";
    return "Masinis gydymas";
  }, [activeLines, products]);

  const herdPriceCents = herdPrice.trim() ? toCents(herdPrice) : null;
  const priceInvalid = herdPrice.trim() !== "" && (herdPriceCents === null || herdPriceCents <= 0);
  const herdLabel = herd && herd !== ALL_HERDS && herd !== NO_HERD ? `banda ${herd}` : "";
  const shareCents = herdPriceCents && animalCount ? Math.floor(herdPriceCents / animalCount) : null;
  const sharesDiffer = herdPriceCents && animalCount ? herdPriceCents % animalCount !== 0 : false;

  const shortages = activeLines
    .map((l) => ({ line: l, need: Number(l.qty) * animalCount, have: availableFor(l) }))
    .filter((s) => s.need > s.have);

  // ---- submit --------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (animalCount === 0) return setError("Pasirinkite klientą, bandą ir bent vieną gyvūną.");
    if (!date) return setError("Įveskite datą.");
    if (activeLines.length === 0) return setError("Pridėkite bent vieną produktą su kiekiu vienam gyvūnui.");
    if (lines.some((l) => (l.productId && !(Number(l.qty) > 0)) || (!l.productId && l.qty))) {
      return setError("Kiekvienai eilutei pasirinkite produktą ir kiekį vienam gyvūnui.");
    }
    if (priceInvalid) return setError("Kaina visai bandai turi būti skaičius, didesnis už 0 (pvz. 150 arba 149,90).");
    if (shortages.length > 0) {
      const s = shortages[0];
      const product = products.find((p) => p.id === s.line.productId);
      return setError(`Nepakanka atsargų „${product?.name}“: reikia ${formatQty(s.need, product?.unit)}, turima ${formatQty(s.have, product?.unit)}.`);
    }

    const summary = activeLines
      .map((l) => {
        const p = products.find((x) => x.id === l.productId);
        return `• ${p?.name}: ${formatQty(Number(l.qty), p?.unit)} kiekvienam`;
      })
      .join("\n");
    const priceNote = herdPriceCents ? `\n\nKaina VISAI bandai: ${formatMoney(centsToNumber(herdPriceCents))} (padalinta po lygiai ${animalCount} gyvūnams).` : "\n\nKaina nenurodyta — vizitų kainas įvesite vėliau.";
    if (!confirm(`Užregistruoti ${animalCount} gyvūnų (${formatDate(date)})?\n\n${summary}${priceNote}\n\nKiekvienam gyvūnui bus sukurtas vizitas, o atsargos nurašytos.`)) return;

    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("create_mass_treatment", {
      p_animal_ids: [...selected],
      p_visit_date: date,
      p_vet_name: (vet ?? profileName) || null,
      p_reason: reason.trim() || derivedReason,
      p_diagnosis: diagnosis.trim() || null,
      p_notes: notes.trim() || null,
      p_items: activeLines.map((l) => ({ product_id: l.productId, batch_id: l.batchId || null, qty: Number(l.qty) })),
      p_herd_price: herdPriceCents ? centsToNumber(herdPriceCents) : null,
      p_price_title: [reason.trim() || derivedReason, herdLabel].filter(Boolean).join(", "),
    });
    setSaving(false);

    if (rpcError || !data) {
      setError(rpcError?.message ?? "Nepavyko užregistruoti.");
      return;
    }
    setDone({ animals: data.visits, products: activeLines.length });
    setLines([emptyLine()]);
    setSelected(new Set(herdAnimals.map((a) => a.id)));
    setReason("");
    setHerdPrice("");
    setDiagnosis("");
    setNotes("");
    load();
  }

  return (
    <div>
      <PageHeader
        title="Masinis gydymas / vakcinacija"
        description="Pasirinkite bandą ir produktus — kiekvienam bandos gyvūnui bus sukurtas vizitas, įrašai žurnaluose ir nurašytos atsargos."
      />

      {done && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            Užregistruota: <b>{done.animals}</b> gyvūnų, <b>{done.products}</b> produkt. Atsargos nurašytos, įrašai pateko į žurnalus.{" "}
            <Link href="/visits" className="font-medium underline">
              Peržiūrėti vizitus
            </Link>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Kraunama...</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card title="1. Gyvūnai" titleIcon={<Syringe size={16} className="text-emerald-600" />}>
            {clientOptions.length === 0 ? (
              <EmptyState message="Aktyvių gyvūnų nėra. Pirmiausia pridėkite gyvūnus skyriuje „Gyvūnai“." />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Klientas" value={clientId} onChange={(e) => chooseClient(e.target.value)}>
                    <option value="">— Pasirinkti —</option>
                    {clientOptions.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                  <Select label="Banda" value={herd} disabled={!clientId} onChange={(e) => chooseHerd(e.target.value)}>
                    <option value="">— Pasirinkti —</option>
                    {herdOptions.length > 1 && <option value={ALL_HERDS}>Visi kliento gyvūnai ({clientAnimals.length} gyv.)</option>}
                    {herdOptions.map((h) => (
                      <option key={h.value} value={h.value}>
                        {h.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {herd && (
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        Gydomi gyvūnai: {animalCount} iš {herdAnimals.length}
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setSelected(new Set(herdAnimals.map((a) => a.id)))}>
                          Pažymėti visus
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
                          Nuimti visus
                        </Button>
                      </div>
                    </div>
                    <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3">
                      {herdAnimals.map((a) => (
                        <li key={a.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={selected.has(a.id)}
                              onChange={() => toggleAnimal(a.id)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="font-medium text-slate-900">{a.tag_no}</span>
                            {a.name && <span className="text-slate-500">({a.name})</span>}
                            <span className="ml-auto text-xs text-slate-400">{speciesLabel(a.species)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="2. Produktai (kiekis vienam gyvūnui)" titleIcon={<Syringe size={16} className="text-emerald-600" />}>
            <div className="space-y-3">
              {lines.map((l) => {
                const product = products.find((p) => p.id === l.productId);
                const productBatches = batches.filter((b) => b.product_id === l.productId);
                const need = Number(l.qty) * animalCount;
                const have = availableFor(l);
                return (
                  <div key={l.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
                      <SearchSelect
                        label="Produktas"
                        options={productOptionsFor(l)}
                        value={l.productId}
                        onChange={(productId) => updateLine(l.key, { productId, batchId: "" })}
                      />
                      <Select
                        label="Partija"
                        disabled={!l.productId}
                        value={l.batchId}
                        onChange={(e) => updateLine(l.key, { batchId: e.target.value })}
                      >
                        <option value="">Automatiškai (seniausiai galiojanti)</option>
                        {productBatches.map((b) => (
                          <option key={b.batch_id} value={b.batch_id}>
                            {b.lot ?? "be serijos"} · liko {formatQty(b.qty_left, b.unit)}
                            {b.expiry_date ? ` · iki ${formatDate(b.expiry_date)}` : ""}
                          </option>
                        ))}
                      </Select>
                      <Input
                        label={`Kiekis${product ? `, ${product.unit}` : ""}`}
                        type="number"
                        step="any"
                        min={0}
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="Pašalinti eilutę"
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                    {product && Number(l.qty) > 0 && animalCount > 0 && (
                      <p className={`mt-2 text-xs ${need > have ? "font-medium text-red-600" : "text-slate-500"}`}>
                        Iš viso {formatQty(need, product.unit)} ({animalCount} × {formatQty(Number(l.qty), product.unit)}); turima {formatQty(have, product.unit)}
                        {need > have && " — nepakanka atsargų"}
                      </p>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus size={16} /> Pridėti produktą
              </Button>
            </div>
          </Card>

          <Card title="3. Vizito duomenys">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DateInput label="Data" required value={date} onChange={setDate} />
              <Input label="Veterinaras" value={vet ?? profileName} onChange={(e) => setVet(e.target.value)} />
              <Input label="Būklė / priežastis" placeholder={derivedReason} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Input label="Diagnozė (nebūtina)" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
              <Input wrapperClassName="sm:col-span-2" label="Pastabos (nebūtina)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </Card>

          <Card title="4. Kaina visai bandai">
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <Input
                label={`Kaina VISAI bandai, €${animalCount ? ` (viso už ${animalCount} gyv.)` : ""}`}
                type="number"
                step="0.01"
                min={0}
                placeholder="nebūtina"
                value={herdPrice}
                onChange={(e) => setHerdPrice(e.target.value)}
              />
              <p className="text-sm text-slate-600">
                {herdPriceCents && !priceInvalid && shareCents !== null ? (
                  <>
                    Tai <b>bendra</b> visos bandos kaina (su vaistais), ne kaina už gyvūną. Bus padalinta po lygiai:{" "}
                    <b>{formatMoney(centsToNumber(shareCents))}</b>
                    {sharesDiffer && " (+ 1 ct kai kuriems, kad suma sutaptų)"} kiekvienam gyvūnui.
                  </>
                ) : (
                  "Palikite tuščią, jei kainos įvesite vėliau kiekvienam vizitui atskirai."
                )}
              </p>
            </div>
          </Card>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || animalCount === 0}>
              <Syringe size={16} /> {saving ? "Registruojama..." : `Užregistruoti${animalCount ? ` (${animalCount} gyv.)` : ""}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
