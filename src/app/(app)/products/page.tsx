"use client";

import { useEffect, useState } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, ProductCategory } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { CATEGORY_LABELS, UNIT_LABELS } from "@/lib/labels";
import { EMPTY_PRODUCT_FORM, ProductFormFields, productFormToPayload } from "@/components/ProductFormFields";

type Product = Database["public"]["Tables"]["products"]["Row"];

const CATEGORY_COLORS: Record<ProductCategory, string> = {
  medicines: "bg-blue-50 text-blue-700",
  vaccines: "bg-purple-50 text-purple-700",
  biocides: "bg-fuchsia-50 text-fuchsia-700",
  materials: "bg-slate-100 text-slate-700",
  hygiene: "bg-cyan-50 text-cyan-700",
  other: "bg-slate-100 text-slate-700",
};

const EMPTY_FORM = EMPTY_PRODUCT_FORM;

export default function ProductsPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("products").select("*").order("name");
    setProducts(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      category: p.category,
      unit: p.unit,
      package_size: p.package_size?.toString() ?? "",
      active_substance: p.active_substance ?? "",
      registration_code: p.registration_code ?? "",
      notes: p.notes ?? "",
      is_active: p.is_active,
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = productFormToPayload(form);

    const { error } = editing
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setModalOpen(false);
    load();
  }

  async function handleDelete(p: Product) {
    if (!confirm(`Ištrinti produktą "${p.name}"? Tai galima tik jei nėra partijų.`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}. Galbūt yra susietų partijų — pažymėkite produktą neaktyviu vietoj to.`);
      return;
    }
    load();
  }

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Produktai"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas produktas
          </Button>
        }
      />

      <div className="mb-4">
        <input
          placeholder="Ieškoti pagal pavadinimą..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Produktų nerasta." />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Pavadinimas</th>
                <th className="px-5 py-3">Kategorija</th>
                <th className="px-5 py-3">Vnt.</th>
                <th className="px-5 py-3">Veiklioji medžiaga</th>
                <th className="px-5 py-3">Būsena</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3">
                    <Badge className={CATEGORY_COLORS[p.category]}>{CATEGORY_LABELS[p.category]}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{UNIT_LABELS[p.unit]}</td>
                  <td className="px-5 py-3 text-slate-600">{p.active_substance ?? "—"}</td>
                  <td className="px-5 py-3">
                    {p.is_active ? (
                      <Badge className="bg-emerald-50 text-emerald-700">Aktyvus</Badge>
                    ) : (
                      <Badge>Neaktyvus</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Redaguoti"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        aria-label="Ištrinti"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
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
        title={editing ? "Redaguoti produktą" : "Naujas produktas"}
        icon={<Package size={18} />}
        iconClassName="bg-amber-50 text-amber-600"
        wide
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <ProductFormFields form={form} onChange={setForm} />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saugoma..." : "Išsaugoti"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
