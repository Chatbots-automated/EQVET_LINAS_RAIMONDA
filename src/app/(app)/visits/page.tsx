"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BadgeEuro, ClipboardList, Pencil, Plus, Receipt, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, Unit } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { DateField, DateInput, Input, SearchSelect, Textarea } from "@/components/ui/Field";
import { formatDate, formatMoney, formatQty, todayISO } from "@/lib/format";
import { useProfileName } from "@/lib/profile";
import { visitInvoiceLines, visitServiceLines } from "@/lib/visit-pricing";
import { loadInvoicesByVisit, type VisitInvoice } from "@/lib/visit-invoices";
import { loadServiceCatalog, type CatalogService } from "@/lib/service-catalog";
import { InvoiceDraftModal, type DraftLine } from "@/components/invoices/InvoiceDraftModal";
import { VisitPricingModal } from "@/components/visits/VisitPricingModal";

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
  visit_date: "",
  reason: "",
  diagnosis: "",
  services: "",
  vet_name: "",
  notes: "",
  first_symptoms_date: "",
  tests: "",
  outcome: "",
};

const FILTER_INPUT = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

const OUTCOME_OPTIONS = ["Pasveiko", "Tęsiamas gydymas", "Nugaišo", "Paskerstas", "Eutanazija"];

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
  const visitParam = searchParams.get("visit");
  const profileName = useProfileName();

  const [visits, setVisits] = useState<Visit[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_VISIT_FORM);
  const [lines, setLines] = useState<UsageLine[]>([emptyLine()]);
  const [serviceRows, setServiceRows] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailVisit, setDetailVisit] = useState<Visit | null>(null);
  const [addLine, setAddLine] = useState<UsageLine>(emptyLine());
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineError, setAddLineError] = useState<string | null>(null);

  // "Vizito užbaigimas" (prices) and the invoice draft each work on their own
  // visit, so they can follow a just-created visit without the detail modal.
  const [pricingVisit, setPricingVisit] = useState<Visit | null>(null);
  const [invoiceVisit, setInvoiceVisit] = useState<Visit | null>(null);
  const [invoicesByVisit, setInvoicesByVisit] = useState<Map<string, VisitInvoice[]>>(new Map());
  const [catalog, setCatalog] = useState<CatalogService[]>([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [clientFilter, setClientFilter] = useState(searchParams.get("client") ?? "");
  const [search, setSearch] = useState("");

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
    setCatalog(await loadServiceCatalog(supabase));
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

  async function loadInvoices() {
    setInvoicesByVisit(await loadInvoicesByVisit(supabase));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from a client's page / an invoice: /visits?visit=<id> opens that visit.
  useEffect(() => {
    if (!visitParam || loading) return;
    const v = visits.find((x) => x.visit_id === visitParam);
    if (v) openDetail(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitParam, loading]);

  const visitInvoices = detailVisit ? invoicesByVisit.get(detailVisit.visit_id) ?? [] : [];

  // Draft lines for "Išrašyti sąskaitą": the visit's services and products,
  // with the prices confirmed in "Vizito užbaigimas".
  const invoiceLines = useMemo<DraftLine[]>(() => (invoiceVisit ? visitInvoiceLines(invoiceVisit) : []), [invoiceVisit]);

  async function fetchVisit(visitId: string) {
    const { data } = await supabase.from("visit_history_view").select("*").eq("visit_id", visitId).single();
    return data;
  }

  const filteredVisits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter((v) => {
      if (dateFrom && v.visit_date < dateFrom) return false;
      if (dateTo && v.visit_date > dateTo) return false;
      if (clientFilter && v.client_id !== clientFilter) return false;
      if (!q) return true;
      return [v.animal_tag, v.animal_name, v.client_name, v.reason, v.diagnosis, v.services, ...v.products_used.map((u) => u.product_name)]
        .some((x) => x?.toLowerCase().includes(q));
    });
  }, [visits, dateFrom, dateTo, clientFilter, search]);

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
    setForm({ ...EMPTY_VISIT_FORM, visit_date: todayISO(), vet_name: profileName, animal_id: animalFilter ?? "" });
    setLines([emptyLine()]);
    setServiceRows([""]);
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
    if (!form.visit_date) {
      setError("Įveskite vizito datą.");
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
        // One row per service; the names are split back into priced lines in "Vizito užbaigimas".
        services: serviceRows.map((r) => r.trim().replace(/[,;]+/g, " ")).filter(Boolean).join(", ") || null,
        vet_name: form.vet_name.trim() || profileName || null,
        notes: form.notes.trim() || null,
        first_symptoms_date: form.first_symptoms_date || null,
        tests: form.tests.trim() || null,
        outcome: form.outcome.trim() || null,
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

    const saved = await fetchVisit(visit.id);
    setSaving(false);
    setCreateOpen(false);
    loadVisits();
    loadReference();

    if (usageErrors.length > 0) {
      // The visit exists — open its card so the missing products can be added there.
      if (saved) openDetail(saved);
      setAddLineError(`Vizitas išsaugotas, bet kai kurių produktų nurašyti nepavyko: ${usageErrors.join("; ")}. Pridėkite juos čia.`);
      return;
    }
    // Visit finished → prices (antkainis + service prices) right away.
    if (saved) setPricingVisit(saved);
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

  async function handleDeleteUsage(visitId: string, usageItemId: string) {
    if (!confirm("Pašalinti šį panaudotą produktą? Atsargos bus atstatytos.")) return;

    const { error } = await supabase.from("usage_items").delete().eq("id", usageItemId);
    if (error) {
      alert(`Nepavyko pašalinti: ${error.message}`);
      return;
    }
    loadVisits();
    loadReference();
    const data = await fetchVisit(visitId);
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
    const data = await fetchVisit(detailVisit.visit_id);
    if (data) setDetailVisit(data);
  }

  function openDetail(v: Visit) {
    setDetailVisit(v);
    setEditingDetails(false);
    setDetailError(null);
    setAddLineError(null);
    setAddLine(emptyLine());
    setDetailForm({
      animal_id: v.animal_id ?? "",
      visit_date: v.visit_date,
      reason: v.reason ?? "",
      diagnosis: v.diagnosis ?? "",
      services: v.services ?? "",
      vet_name: v.vet_name ?? "",
      notes: v.notes ?? "",
      first_symptoms_date: v.first_symptoms_date ?? "",
      tests: v.tests ?? "",
      outcome: v.outcome ?? "",
    });
  }

  async function handleSaveDetails() {
    if (!detailVisit) return;
    if (!detailForm.visit_date) {
      setDetailError("Įveskite vizito datą.");
      return;
    }
    setDetailSaving(true);
    setDetailError(null);

    const { error } = await supabase
      .from("visits")
      .update({
        visit_date: detailForm.visit_date,
        reason: detailForm.reason.trim() || null,
        diagnosis: detailForm.diagnosis.trim() || null,
        vet_name: detailForm.vet_name.trim() || null,
        notes: detailForm.notes.trim() || null,
        first_symptoms_date: detailForm.first_symptoms_date || null,
        tests: detailForm.tests.trim() || null,
        outcome: detailForm.outcome.trim() || null,
      })
      .eq("id", detailVisit.visit_id);

    setDetailSaving(false);
    if (error) {
      setDetailError(error.message);
      return;
    }

    setEditingDetails(false);
    loadVisits();
    const data = await fetchVisit(detailVisit.visit_id);
    if (data) setDetailVisit(data);
  }

  function handlePricingSaved(updated: Visit, thenInvoice: boolean) {
    setPricingVisit(null);
    loadVisits();
    loadReference(); // new services / prices may have been saved to the list
    if (detailVisit?.visit_id === updated.visit_id) setDetailVisit(updated);
    if (thenInvoice) setInvoiceVisit(updated);
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
            : undefined
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Ieškoti: gyvūnas, klientas, paslauga, vaistas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full max-w-xs ${FILTER_INPUT}`}
        />
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={FILTER_INPUT} aria-label="Klientas">
          <option value="">Visi klientai</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="w-36">
          <DateField value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Nuo" />
        </div>
        <span className="text-sm text-slate-400">–</span>
        <div className="w-36">
          <DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Iki" />
        </div>
        {(search || clientFilter || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSearch("");
              setClientFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Išvalyti ×
          </button>
        )}
        {filteredVisits.length > 0 && (
          <span className="ml-auto text-sm text-slate-600">
            {filteredVisits.length} viz. · <span className="font-semibold text-slate-900">{formatMoney(filteredVisits.reduce((s, v) => s + v.total_price, 0))}</span>
          </span>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : filteredVisits.length === 0 ? (
          <div className="p-5">
            <EmptyState message={visits.length === 0 ? "Vizitų dar nėra." : "Pagal pasirinktus filtrus vizitų nerasta."} />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Gyvūnas</th>
                <th className="px-5 py-3">Priežastis / diagnozė</th>
                <th className="px-5 py-3">Paslaugos / produktai</th>
                <th className="px-5 py-3 text-right">Suma</th>
                <th className="px-5 py-3">Būsena</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVisits.map((v) => (
                <tr
                  key={v.visit_id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => openDetail(v)}
                >
                  <td className="px-5 py-3 text-slate-600">{formatDate(v.visit_date)}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{v.animal_tag ?? "—"}</div>
                    {v.client_name && <div className="text-xs text-slate-500">{v.client_name}</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{v.reason || v.diagnosis || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {[v.services, ...v.products_used.map((u) => u.product_name)].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">{v.total_price > 0 ? formatMoney(v.total_price) : "—"}</td>
                  <td className="px-5 py-3">
                    <VisitStatus visit={v} invoices={invoicesByVisit.get(v.visit_id) ?? []} />
                  </td>
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
            <SearchSelect
              label="Gyvūnas"
              required
              placeholder="Ieškoti pagal gyvūną arba klientą..."
              value={form.animal_id}
              onChange={(animal_id) => setForm({ ...form, animal_id })}
              options={animals.map((a) => ({
                value: a.id,
                label: [a.tag_no, a.name].filter(Boolean).join(" · "),
                hint: clientName(a.client_id) ?? undefined,
              }))}
            />
            <DateInput
              label="Vizito data"
              required
              value={form.visit_date}
              onChange={(visit_date) => setForm({ ...form, visit_date })}
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

          <VisitRegistryFields value={form} onChange={(patch) => setForm({ ...form, ...patch })} />

          <Input
            label="Veterinarijos gydytojas"
            value={form.vet_name}
            onChange={(e) => setForm({ ...form, vet_name: e.target.value })}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Suteiktos paslaugos</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setServiceRows([...serviceRows, ""])}>
                <Plus size={14} /> Pridėti paslaugą
              </Button>
            </div>
            <div className="space-y-2">
              {serviceRows.map((row, i) => {
                const saved = catalog.find((c) => c.name.toLowerCase() === row.trim().toLowerCase());
                return (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <input
                      list="visit-service-catalog"
                      placeholder="Pasirinkite iš sąrašo arba įrašykite naują"
                      aria-label={`Paslauga ${i + 1}`}
                      value={row}
                      onChange={(e) => setServiceRows(serviceRows.map((r, j) => (j === i ? e.target.value : r)))}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                    {saved?.price != null && (
                      <span className="whitespace-nowrap text-xs text-slate-500">{formatMoney(saved.price)}</span>
                    )}
                    <button
                      type="button"
                      aria-label="Pašalinti paslaugą"
                      onClick={() => setServiceRows(serviceRows.length > 1 ? serviceRows.filter((_, j) => j !== i) : [""])}
                      className="flex justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <datalist id="visit-service-catalog">
              {catalog.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.price != null ? formatMoney(c.price) : ""}
                </option>
              ))}
            </datalist>
            <p className="mt-1.5 text-xs text-slate-500">
              Kainos įvedamos išsaugojus vizitą — atsidarys „Vizito užbaigimas“; išsaugotų paslaugų kainos įsirašys pačios.
            </p>
          </div>

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

          <Textarea
            label="Pastabos"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

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
                  <DateInput
                    label="Vizito data"
                    required
                    value={detailForm.visit_date}
                    onChange={(visit_date) => setDetailForm({ ...detailForm, visit_date })}
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
                <VisitRegistryFields
                  value={detailForm}
                  onChange={(patch) => setDetailForm({ ...detailForm, ...patch })}
                />
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
                  <div className="text-xs text-slate-500">Pirmųjų požymių data</div>
                  <div>{formatDate(detailVisit.first_symptoms_date)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Atlikti tyrimai</div>
                  <div>{detailVisit.tests || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Ligos baigtis</div>
                  <div>{detailVisit.outcome || "—"}</div>
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
              <div className="mb-2 text-sm font-medium text-slate-700">Paslaugos</div>
              {visitServiceLines(detailVisit).length === 0 ? (
                <p className="text-sm text-slate-500">Paslaugos nenurodytos.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {visitServiceLines(detailVisit).map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{s.title}</span>
                      <span className="text-slate-700">{formatMoney(s.price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Panaudoti produktai</div>
              {detailVisit.products_used.length === 0 ? (
                <p className="text-sm text-slate-500">Produktai nenurašyti.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detailVisit.products_used.map((u) => (
                    <div key={u.usage_item_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>
                        {u.product_name} — {formatQty(u.quantity, u.unit)}
                        {u.batch_lot ? ` (partija ${u.batch_lot})` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-700">{formatMoney(u.sale_total)}</span>
                        <button
                          onClick={() => handleDeleteUsage(detailVisit.visit_id, u.usage_item_id)}
                          aria-label="Pašalinti produktą"
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
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

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm">
                <div className="flex items-center gap-2 font-medium text-slate-700">
                  Vizito suma
                  <VisitStatus visit={detailVisit} invoices={[]} />
                </div>
                <div className="text-xl font-bold text-slate-900">{formatMoney(detailVisit.total_price)}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPricingVisit(detailVisit)}>
                <BadgeEuro size={14} /> {detailVisit.completed_at ? "Keisti kainas" : "Užbaigti vizitą (kainos)"}
              </Button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium text-slate-700">Sąskaitos</div>
                  {visitInvoices.length === 0 ? (
                    <div className="text-slate-500">Sąskaita dar neišrašyta.</div>
                  ) : (
                    <div className="text-slate-700">
                      {visitInvoices.map((i) => (
                        <span key={i.id} className="mr-3">
                          {i.status === "created" ? `${i.series_title ?? ""} ${i.series_number ?? ""}` : "neišrašyta"} · {formatMoney(i.total)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => setInvoiceVisit(detailVisit)}
                  disabled={!detailVisit.client_id}
                  title={detailVisit.client_id ? undefined : "Gyvūnas nepriskirtas klientui"}
                >
                  <Receipt size={14} /> Išrašyti sąskaitą
                </Button>
              </div>
              {!detailVisit.client_id && (
                <p className="mt-1 text-xs text-slate-500">Norint išrašyti sąskaitą, gyvūnas turi būti priskirtas klientui.</p>
              )}
              {detailVisit.client_id && (
                <Link href={`/clients/${detailVisit.client_id}`} className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline">
                  Visi kliento „{detailVisit.client_name}“ vizitai ir sąskaitos →
                </Link>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="danger" onClick={() => handleDeleteVisit(detailVisit)}>
                <Trash2 size={16} /> Ištrinti vizitą
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {pricingVisit && (
        <VisitPricingModal
          key={pricingVisit.visit_id}
          visit={pricingVisit}
          onClose={() => setPricingVisit(null)}
          onSaved={handlePricingSaved}
        />
      )}

      <InvoiceDraftModal
        open={!!invoiceVisit}
        onClose={() => {
          setInvoiceVisit(null);
          loadInvoices();
        }}
        clients={clients}
        initialClientId={invoiceVisit?.client_id ?? null}
        lockClient
        visitId={invoiceVisit?.visit_id ?? null}
        initialLines={invoiceLines}
      />
    </div>
  );
}

function VisitStatus({ visit, invoices }: { visit: Visit; invoices: VisitInvoice[] }) {
  const issued = invoices.filter((i) => i.status === "created");
  if (issued.length > 0) {
    return (
      <Badge className="bg-emerald-50 text-emerald-700">
        {issued.map((i) => `${i.series_title ?? ""} ${i.series_number ?? ""}`.trim()).join(", ")}
      </Badge>
    );
  }
  return visit.completed_at ? (
    <Badge className="bg-sky-50 text-sky-700">Užbaigtas</Badge>
  ) : (
    <Badge className="bg-amber-50 text-amber-700">Neužbaigtas</Badge>
  );
}

// Extra columns of the "Gydomų gyvūnų registracijos žurnalas" (Ataskaitos),
// shared by the create form and the detail edit form.
function VisitRegistryFields({
  value,
  onChange,
}: {
  value: { first_symptoms_date: string; tests: string; outcome: string };
  onChange: (patch: Partial<typeof EMPTY_VISIT_FORM>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <DateInput
        label="Pirmųjų požymių data"
        value={value.first_symptoms_date}
        onChange={(first_symptoms_date) => onChange({ first_symptoms_date })}
      />
      <Input label="Atlikti tyrimai" value={value.tests} onChange={(e) => onChange({ tests: e.target.value })} />
      <Input
        label="Ligos baigtis"
        list="visit-outcome-options"
        value={value.outcome}
        onChange={(e) => onChange({ outcome: e.target.value })}
      />
      <datalist id="visit-outcome-options">
        {OUTCOME_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
