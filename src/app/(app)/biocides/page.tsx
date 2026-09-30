"use client";

import { useEffect, useState } from "react";
import { Droplet, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfileName } from "@/lib/profile";
import type { Database, Unit } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { DateInput, Input, Select, Textarea } from "@/components/ui/Field";
import { formatDate, formatQty, todayISO } from "@/lib/format";

type Product = Database["public"]["Tables"]["products"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];
type StockRow = Database["public"]["Views"]["stock_by_product"]["Row"];
type JournalRow = Database["public"]["Views"]["vw_biocide_journal"]["Row"];

function emptyForm(usedBy = "") {
  return {
    product_id: "",
    batch_id: "",
    use_date: todayISO(),
    qty: "",
    unit: "" as Unit | "",
    purpose: "",
    work_scope: "",
    used_by_name: usedBy,
    notes: "",
  };
}

export default function BiocidesPage() {
  const supabase = createClient();
  const defaultUsedBy = useProfileName();

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [usage, setUsage] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: p }, { data: b }, { data: s }, { data: u }] = await Promise.all([
      supabase.from("products").select("*").eq("category", "biocides").eq("is_active", true).order("name"),
      supabase
        .from("stock_by_batch")
        .select("*")
        .eq("product_category", "biocides")
        .gt("qty_left", 0)
        .order("expiry_date", { nullsFirst: false }),
      supabase.from("stock_by_product").select("*").eq("product_category", "biocides").order("product_name"),
      supabase
        .from("vw_biocide_journal")
        .select("*")
        .order("use_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setProducts(p ?? []);
    setBatches(b ?? []);
    setStock(s ?? []);
    setUsage(u ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setForm(emptyForm(defaultUsedBy));
    setError(null);
    setModalOpen(true);
  }

  async function handleProductChange(productId: string) {
    const product = products.find((p) => p.id === productId);
    const { data: suggested } = productId
      ? await supabase.rpc("fn_fifo_batch", { p_product_id: productId })
      : { data: null };
    setForm((f) => ({ ...f, product_id: productId, batch_id: suggested ?? "", unit: product?.unit ?? "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.product_id || !form.batch_id || !Number(form.qty) || !form.unit) {
      setError("Pasirinkite produktą, partiją ir įveskite kiekį.");
      return;
    }
    if (!form.use_date) {
      setError("Įveskite panaudojimo datą.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("biocide_usage").insert({
      product_id: form.product_id,
      batch_id: form.batch_id,
      use_date: form.use_date,
      qty: Number(form.qty),
      unit: form.unit,
      purpose: form.purpose.trim() || null,
      work_scope: form.work_scope.trim() || null,
      used_by_name: form.used_by_name.trim() || defaultUsedBy || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setModalOpen(false);
    load();
  }

  async function handleDelete(row: JournalRow) {
    if (!row.biocide_usage_id) return;
    if (!confirm("Ištrinti šį biocido panaudojimą? Atsargos bus atstatytos.")) return;
    const { error } = await supabase.from("biocide_usage").delete().eq("id", row.biocide_usage_id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  const productBatches = batches.filter((b) => b.product_id === form.product_id);

  return (
    <div>
      <PageHeader
        title="Biocidai"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas panaudojimas
          </Button>
        }
      />

      <Card title="Biocidų likučiai" className="mb-6 overflow-hidden">
        {loading ? (
          <div className="text-sm text-slate-500">Kraunama...</div>
        ) : products.length === 0 ? (
          <EmptyState message="Nėra biocidų. Sukurkite produktą su kategorija „Biocidai“ (Produktai) ir užpajamuokite jį (Pajamavimas)." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => {
              const s = stock.find((row) => row.product_id === p.id);
              const onHand = s?.on_hand ?? 0;
              return (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{p.name}</span>
                    <Badge className={onHand > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                      {formatQty(onHand, p.unit)}
                    </Badge>
                  </div>
                  {p.active_substance && <p className="mt-1 text-xs text-slate-500">{p.active_substance}</p>}
                  {s?.nearest_expiry && (
                    <p className="mt-1 text-xs text-slate-500">Artimiausias galiojimas: {formatDate(s.nearest_expiry)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Paskutiniai panaudojimai" className="overflow-hidden">
        {loading ? (
          <div className="text-sm text-slate-500">Kraunama...</div>
        ) : usage.length === 0 ? (
          <EmptyState message="Biocidų panaudojimų dar nėra." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Biocidas</th>
                  <th className="px-5 py-3">Kiekis</th>
                  <th className="px-5 py-3">Paskirtis</th>
                  <th className="px-5 py-3">Darbų apimtis</th>
                  <th className="px-5 py-3">Naudojo</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usage.map((u) => (
                  <tr key={u.entry_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">{formatDate(u.use_date)}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {u.biocide_name}
                      {u.batch_number && <span className="ml-1 text-xs text-slate-400">({u.batch_number})</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatQty(u.quantity_used, u.unit)}</td>
                    <td className="px-5 py-3 text-slate-600">{u.purpose || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{u.work_scope || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{u.applied_by || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      {u.biocide_usage_id ? (
                        <button
                          onClick={() => handleDelete(u)}
                          aria-label="Ištrinti"
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <Badge className="bg-rose-50 text-rose-700">Vizitas</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Naujas biocido panaudojimas"
        icon={<Droplet size={18} />}
        iconClassName="bg-fuchsia-50 text-fuchsia-600"
        wide
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DateInput
              label="Panaudojimo data"
              required
              value={form.use_date}
              onChange={(use_date) => setForm({ ...form, use_date })}
            />
            <Select
              label="Biocidinis produktas"
              required
              value={form.product_id}
              onChange={(e) => handleProductChange(e.target.value)}
            >
              <option value="">— Pasirinkti —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Partija"
              required
              value={form.batch_id}
              disabled={!form.product_id}
              onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
            >
              <option value="">— Pasirinkti —</option>
              {productBatches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.lot ?? "be žymos"} · liko {formatQty(b.qty_left, b.unit)}
                  {b.expiry_date ? ` · iki ${formatDate(b.expiry_date)}` : ""}
                </option>
              ))}
            </Select>
            <Input
              label={`Kiekis${form.unit ? ` (${form.unit})` : ""}`}
              type="number"
              step="any"
              min="0"
              required
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </div>
          {form.product_id && productBatches.length === 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Šio biocido likučio nėra — pirmiausia užpajamuokite jį (Pajamavimas).
            </p>
          )}
          <Input
            label="Panaudojimo paskirtis"
            placeholder="Dezinfekcija, kenkėjų kontrolė..."
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
          <Input
            label="Darbų apimtis"
            placeholder="Vieta / plotas / įranga"
            value={form.work_scope}
            onChange={(e) => setForm({ ...form, work_scope: e.target.value })}
          />
          <Input
            label="Biocidą naudojęs asmuo"
            value={form.used_by_name}
            onChange={(e) => setForm({ ...form, used_by_name: e.target.value })}
          />
          <Textarea label="Pastabos" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saugoma..." : "Registruoti panaudojimą"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
