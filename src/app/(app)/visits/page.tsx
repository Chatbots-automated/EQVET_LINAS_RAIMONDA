"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, Unit } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { formatDate, formatMoney, formatQty } from "@/lib/format";

type Animal = Database["public"]["Tables"]["animals"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type Product = Database["public"]["Tables"]["products"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];
type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];

interface UsageLine {
  product_id: string;
  batch_id: string;
  qty: string;
  unit: Unit | "";
}

const EMPTY_VISIT_FORM = {
  animal_id: "",
  visit_date: new Date().toISOString().slice(0, 10),
  reason: "",
  diagnosis: "",
  services: "",
  service_price: "",
  vet_name: "",
  notes: "",
};

function emptyLine(): UsageLine {
  return { product_id: "", batch_id: "", qty: "", unit: "" };
}

export default function VisitsPage() {
  return (
    <Suspense fallback={null}>
      <VisitsPageInner />
    </Suspense>
  );
}

function VisitsPageInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const animalFilter = searchParams.get("animal");

  const [visits, setVisits] = useState<Visit[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_VISIT_FORM);
  const [lines, setLines] = useState<UsageLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailVisit, setDetailVisit] = useState<Visit | null>(null);
  const [addLine, setAddLine] = useState<UsageLine>(emptyLine());
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineError, setAddLineError] = useState<string | null>(null);

  const [editingDetails, setEditingDetails] = useState(false);
  const [detailForm, setDetailForm] = useState(EMPTY_VISIT_FORM);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadReference() {
    const [{ data: a }, { data: cl }, { data: p }, { data: b }] = await Promise.all([
      supabase.from("animals").select("*").eq("active", true).order("tag_no"),
      supabase.from("clients").select("*").order("name"),
      supabase.from("products").select("*").eq("is_active", true).order("name"),
      supabase.from("stock_by_batch").select("*").gt("qty_left", 0).order("expiry_date", { nullsFirst: false }),
    ]);
    setAnimals(a ?? []);
    setClients(cl ?? []);
    setProducts(p ?? []);
    setBatches(b ?? []);
  }

  function clientName(id: string | null) {
    return clients.find((c) => c.id === id)?.name ?? null;
  }

  async function loadVisits() {
    setLoading(true);
    let query = supabase.from("visit_history_view").select("*");
    if (animalFilter) query = query.eq("animal_id", animalFilter);
    const { data } = await query;
    setVisits(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVisits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animalFilter]);

  function batchesForProduct(productId: string) {
    return batches.filter((b) => b.product_id === productId);
  }

  async function suggestBatch(productId: string): Promise<string> {
    const { data } = await supabase.rpc("fn_fifo_batch", { p_product_id: productId });
    return data ?? "";
  }

  async function handleLineProductChange(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    const suggested = productId ? await suggestBatch(productId) : "";
    setLines((prev) =>
      prev.map((l, i) =>
        i === index ? { ...l, product_id: productId, batch_id: suggested, unit: product?.unit ?? "" } : l
      )
    );
  }

  function updateLine(index: number, patch: Partial<UsageLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function openCreate() {
    setForm({ ...EMPTY_VISIT_FORM, animal_id: animalFilter ?? "" });
    setLines([emptyLine()]);
    setError(null);
    setCreateOpen(true);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.animal_id) {
      setError("Pasirinkite gyvūną.");
      return;
    }

    setSaving(true);

    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .insert({
        animal_id: form.animal_id,
        visit_date: form.visit_date,
        reason: form.reason.trim() || null,
        diagnosis: form.diagnosis.trim() || null,
        services: form.services.trim() || null,
        service_price: form.service_price ? Number(form.service_price) : null,
        vet_name: form.vet_name.trim() || null,
        notes: form.notes.trim() || null,
      })
      .select()
      .single();

    if (visitError || !visit) {
      setSaving(false);
      setError(visitError?.message ?? "Nepavyko sukurti vizito.");
      return;
    }

    const validLines = lines.filter((l) => l.product_id && l.batch_id && Number(l.qty) > 0);
    const usageErrors: string[] = [];

    for (const line of validLines) {
      const { error: usageError } = await supabase.from("usage_items").insert({
        visit_id: visit.id,
        product_id: line.product_id,
        batch_id: line.batch_id,
        qty: Number(line.qty),
        unit: line.unit as Unit,
      });
      if (usageError) usageErrors.push(usageError.message);
    }

    setSaving(false);

    if (usageErrors.length > 0) {
      setError(
        `Vizitas išsaugotas, bet kai kurių produktų nurašyti nepavyko: ${usageErrors.join("; ")}. Galite pridėti juos vėliau vizito kortelėje.`
      );
    } else {
      setCreateOpen(false);
    }

    loadVisits();
    loadReference();
  }

  async function handleDeleteVisit(v: Visit) {
    if (!confirm("Ištrinti vizitą? Bus atstatytos panaudotų produktų atsargos.")) return;
    const { error } = await supabase.from("visits").delete().eq("id", v.visit_id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    setDetailVisit(null);
    loadVisits();
    loadReference();
  }

  async function handleDeleteUsage(visitId: string, index: number) {
    // products_used doesn't carry usage_item id, so re-fetch the raw rows to delete precisely.
    const { data: items } = await supabase
      .from("usage_items")
      .select("id")
      .eq("visit_id", visitId)
      .order("created_at");
    const target = items?.[index];
    if (!target) return;
    if (!confirm("Pašalinti šį panaudotą produktą? Atsargos bus atstatytos.")) return;

    const { error } = await supabase.from("usage_items").delete().eq("id", target.id);
    if (error) {
      alert(`Nepavyko pašalinti: ${error.message}`);
      return;
    }
    loadVisits();
    loadReference();
    const { data } = await supabase.from("visit_history_view").select("*").eq("visit_id", visitId).single();
    if (data) setDetailVisit(data);
  }

  async function handleAddLineToVisit() {
    if (!detailVisit) return;
    setAddLineError(null);
    if (!addLine.product_id || !addLine.batch_id || !Number(addLine.qty)) {
      setAddLineError("Užpildykite produktą, partiją ir kiekį.");
      return;
    }
    setAddLineSaving(true);
    const { error } = await supabase.from("usage_items").insert({
      visit_id: detailVisit.visit_id,
      product_id: addLine.product_id,
      batch_id: addLine.batch_id,
      qty: Number(addLine.qty),
      unit: addLine.unit as Unit,
    });
    setAddLineSaving(false);
    if (error) {
      setAddLineError(error.message);
      return;
    }
    setAddLine(emptyLine());
    loadVisits();
    loadReference();
    const { data } = await supabase
      .from("visit_history_view")
      .select("*")
      .eq("visit_id", detailVisit.visit_id)
      .single();
    if (data) setDetailVisit(data);
  }

  function openDetail(v: Visit) {
    setDetailVisit(v);
    setEditingDetails(false);
    setDetailError(null);
    setDetailForm({
      animal_id: v.animal_id ?? "",
      visit_date: v.visit_date,
      reason: v.reason ?? "",
      diagnosis: v.diagnosis ?? "",
      services: v.services ?? "",
      service_price: v.service_price?.toString() ?? "",
      vet_name: v.vet_name ?? "",
      notes: v.notes ?? "",
    });
  }

  async function handleSaveDetails() {
    if (!detailVisit) return;
    setDetailSaving(true);
    setDetailError(null);

    const { error } = await supabase
      .from("visits")
      .update({
        visit_date: detailForm.visit_date,
        reason: detailForm.reason.trim() || null,
        diagnosis: detailForm.diagnosis.trim() || null,
        services: detailForm.services.trim() || null,
        service_price: detailForm.service_price ? Number(detailForm.service_price) : null,
        vet_name: detailForm.vet_name.trim() || null,
        notes: detailForm.notes.trim() || null,
      })
      .eq("id", detailVisit.visit_id);

    setDetailSaving(false);
    if (error) {
      setDetailError(error.message);
      return;
    }

    setEditingDetails(false);
    loadVisits();
    const { data } = await supabase
      .from("visit_history_view")
      .select("*")
      .eq("visit_id", detailVisit.visit_id)
      .single();
    if (data) setDetailVisit(data);
  }

  const filterAnimal = useMemo(
    () => animals.find((a) => a.id === animalFilter),
    [animals, animalFilter]
  );

  return (
    <div>
      <PageHeader
        title="Vizitai"
        description={
          filterAnimal
            ? `Gyvūno ${filterAnimal.tag_no} vizitų istorija`
            : "Registruoti gydymai ir produktų nurašymas"
        }
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas vizitas
          </Button>
        }
      />

      {filterAnimal && (
        <a href="/visits" className="mb-4 inline-block text-xs font-medium text-emerald-700 hover:underline">
          × Rodyti visus vizitus
        </a>
      )}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : visits.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Vizitų dar nėra." />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Gyvūnas</th>
                <th className="px-5 py-3">Priežastis / diagnozė</th>
                <th className="px-5 py-3">Panaudoti produktai</th>
                <th className="px-5 py-3">Kaina</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visits.map((v) => (
                <tr
                  key={v.visit_id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => openDetail(v)}
                >
                  <td className="px-5 py-3 text-slate-600">{formatDate(v.visit_date)}</td>
                  <td className="px-5 py-3 font-medium text-slate-900">{v.animal_tag ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{v.reason || v.diagnosis || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {v.products_used.length > 0
                      ? v.products_used.map((u) => u.product_name).join(", ")
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{formatMoney(v.service_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* Create visit modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Naujas vizitas"
        icon={<ClipboardList size={18} />}
        iconClassName="bg-rose-50 text-rose-600"
        wide
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Gyvūnas"
              required
              value={form.animal_id}
              onChange={(e) => setForm({ ...form, animal_id: e.target.value })}
            >
              <option value="">— Pasirinkti —</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tag_no} {clientName(a.client_id) ? `(${clientName(a.client_id)})` : ""}
                </option>
              ))}
            </Select>
            <Input
              label="Vizito data"
              type="date"
              required
              value={form.visit_date}
              onChange={(e) => setForm({ ...form, visit_date: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Priežastis"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
            <Input
              label="Diagnozė"
              value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Suteiktos paslaugos"
              value={form.services}
              onChange={(e) => setForm({ ...form, services: e.target.value })}
            />
            <Input
              label="Paslaugos kaina"
              type="number"
              step="any"
              value={form.service_price}
              onChange={(e) => setForm({ ...form, service_price: e.target.value })}
            />
          </div>

          <Input
            label="Veterinarijos gydytojas"
            value={form.vet_name}
            onChange={(e) => setForm({ ...form, vet_name: e.target.value })}
          />

          <Textarea
            label="Pastabos"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Panaudoti produktai (nurašymas)</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setLines([...lines, emptyLine()])}>
                <Plus size={14} /> Pridėti eilutę
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => {
                const options = batchesForProduct(line.product_id);
                return (
                  <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-slate-200 p-2">
                    <select
                      value={line.product_id}
                      onChange={(e) => handleLineProductChange(i, e.target.value)}
                      className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      <option value="">— Produktas —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={line.batch_id}
                      onChange={(e) => updateLine(i, { batch_id: e.target.value })}
                      className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      disabled={!line.product_id}
                    >
                      <option value="">— Partija —</option>
                      {options.map((b) => (
                        <option key={b.batch_id} value={b.batch_id}>
                          {b.lot ?? "be žymos"} · liko {formatQty(b.qty_left, b.unit)}
                          {b.expiry_date ? ` · iki ${formatDate(b.expiry_date)}` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="any"
                      placeholder="Kiekis"
                      value={line.qty}
                      onChange={(e) => updateLine(i, { qty: e.target.value })}
                      className="col-span-3 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="col-span-1 flex justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saugoma..." : "Išsaugoti vizitą"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Visit detail modal */}
      <Modal
        open={!!detailVisit}
        onClose={() => setDetailVisit(null)}
        title={detailVisit ? `Vizitas · ${detailVisit.animal_tag ?? "—"} · ${formatDate(detailVisit.visit_date)}` : ""}
        icon={<ClipboardList size={18} />}
        iconClassName="bg-rose-50 text-rose-600"
        wide
      >
        {detailVisit && (
          <div className="space-y-4">
            {editingDetails ? (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Vizito data"
                    type="date"
                    required
                    value={detailForm.visit_date}
                    onChange={(e) => setDetailForm({ ...detailForm, visit_date: e.target.value })}
                  />
                  <Input
                    label="Veterinarijos gydytojas"
                    value={detailForm.vet_name}
                    onChange={(e) => setDetailForm({ ...detailForm, vet_name: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Priežastis"
                    value={detailForm.reason}
                    onChange={(e) => setDetailForm({ ...detailForm, reason: e.target.value })}
                  />
                  <Input
                    label="Diagnozė"
                    value={detailForm.diagnosis}
                    onChange={(e) => setDetailForm({ ...detailForm, diagnosis: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Suteiktos paslaugos"
                    value={detailForm.services}
                    onChange={(e) => setDetailForm({ ...detailForm, services: e.target.value })}
                  />
                  <Input
                    label="Paslaugos kaina"
                    type="number"
                    step="any"
                    value={detailForm.service_price}
                    onChange={(e) => setDetailForm({ ...detailForm, service_price: e.target.value })}
                  />
                </div>
                <Textarea
                  label="Pastabos"
                  value={detailForm.notes}
                  onChange={(e) => setDetailForm({ ...detailForm, notes: e.target.value })}
                />

                {detailError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</p>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditingDetails(false)}>
                    Atšaukti
                  </Button>
                  <Button type="button" onClick={handleSaveDetails} disabled={detailSaving}>
                    {detailSaving ? "Saugoma..." : "Išsaugoti"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Priežastis</div>
                  <div>{detailVisit.reason || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Diagnozė</div>
                  <div>{detailVisit.diagnosis || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Paslaugos</div>
                  <div>{detailVisit.services || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Paslaugos kaina</div>
                  <div>{formatMoney(detailVisit.service_price)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Veterinarijos gydytojas</div>
                  <div>{detailVisit.vet_name || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Pastabos</div>
                  <div>{detailVisit.notes || "—"}</div>
                </div>
                <div className="col-span-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditingDetails(true)}>
                    <Pencil size={14} /> Redaguoti vizitą
                  </Button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Panaudoti produktai</div>
              {detailVisit.products_used.length === 0 ? (
                <p className="text-sm text-slate-500">Produktai nenurašyti.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detailVisit.products_used.map((u, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        {u.product_name} — {formatQty(u.quantity, u.unit)}
                        {u.batch_lot ? ` (partija ${u.batch_lot})` : ""}
                      </span>
                      <button
                        onClick={() => handleDeleteUsage(detailVisit.visit_id, i)}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 grid grid-cols-12 items-end gap-2 rounded-lg border border-dashed border-slate-300 p-2">
                <select
                  value={addLine.product_id}
                  onChange={async (e) => {
                    const productId = e.target.value;
                    const product = products.find((p) => p.id === productId);
                    const suggested = productId ? await suggestBatch(productId) : "";
                    setAddLine({ product_id: productId, batch_id: suggested, qty: "", unit: product?.unit ?? "" });
                  }}
                  className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">— Produktas —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={addLine.batch_id}
                  onChange={(e) => setAddLine({ ...addLine, batch_id: e.target.value })}
                  className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={!addLine.product_id}
                >
                  <option value="">— Partija —</option>
                  {batchesForProduct(addLine.product_id).map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {b.lot ?? "be žymos"} · liko {formatQty(b.qty_left, b.unit)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  placeholder="Kiekis"
                  value={addLine.qty}
                  onChange={(e) => setAddLine({ ...addLine, qty: e.target.value })}
                  className="col-span-3 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  className="col-span-1"
                  onClick={handleAddLineToVisit}
                  disabled={addLineSaving}
                >
                  <Plus size={14} />
                </Button>
              </div>
              {addLineError && <p className="mt-1 text-xs text-red-600">{addLineError}</p>}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="danger" onClick={() => handleDeleteVisit(detailVisit)}>
                <Trash2 size={16} /> Ištrinti vizitą
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
