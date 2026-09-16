"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { SPECIES_OPTIONS } from "@/lib/labels";
import { formatDate } from "@/lib/format";

type Animal = Database["public"]["Tables"]["animals"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

const EMPTY_FORM = {
  tag_no: "",
  name: "",
  species: "bovine",
  sex: "",
  breed: "",
  birth_date: "",
  client_id: "",
  notes: "",
  active: true,
};

const EMPTY_QUICK_CLIENT = { name: "", address: "", phone: "" };

export default function AnimalsPage() {
  return (
    <Suspense fallback={null}>
      <AnimalsPageInner />
    </Suspense>
  );
}

function AnimalsPageInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const clientFilter = searchParams.get("client");

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientForm, setQuickClientForm] = useState(EMPTY_QUICK_CLIENT);
  const [quickClientSaving, setQuickClientSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from("animals").select("*").order("tag_no"),
      supabase.from("clients").select("*").order("name"),
    ]);
    setAnimals(a ?? []);
    setClients(c ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clientName(id: string | null) {
    return clients.find((c) => c.id === id)?.name ?? null;
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, client_id: clientFilter ?? "" });
    setError(null);
    setModalOpen(true);
  }

  function openEdit(a: Animal) {
    setEditing(a);
    setForm({
      tag_no: a.tag_no,
      name: a.name ?? "",
      species: a.species,
      sex: a.sex ?? "",
      breed: a.breed ?? "",
      birth_date: a.birth_date ?? "",
      client_id: a.client_id ?? "",
      notes: a.notes ?? "",
      active: a.active,
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      tag_no: form.tag_no.trim(),
      name: form.name.trim() || null,
      species: form.species,
      sex: form.sex || null,
      breed: form.breed.trim() || null,
      birth_date: form.birth_date || null,
      client_id: form.client_id || null,
      notes: form.notes.trim() || null,
      active: form.active,
    };

    const { error } = editing
      ? await supabase.from("animals").update(payload).eq("id", editing.id)
      : await supabase.from("animals").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setModalOpen(false);
    load();
  }

  async function handleDelete(a: Animal) {
    if (!confirm(`Ištrinti gyvūną "${a.tag_no}"? Bus ištrinta ir jo vizitų istorija.`)) return;
    const { error } = await supabase.from("animals").delete().eq("id", a.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  async function handleQuickClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    setQuickClientSaving(true);
    const { data, error } = await supabase
      .from("clients")
      .insert({
        name: quickClientForm.name.trim(),
        address: quickClientForm.address.trim() || null,
        phone: quickClientForm.phone.trim() || null,
      })
      .select()
      .single();
    setQuickClientSaving(false);
    if (error || !data) {
      alert(error?.message ?? "Nepavyko sukurti kliento.");
      return;
    }
    setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((f) => ({ ...f, client_id: data.id }));
    setQuickClientOpen(false);
    setQuickClientForm(EMPTY_QUICK_CLIENT);
  }

  const byClient = clientFilter ? animals.filter((a) => a.client_id === clientFilter) : animals;
  const filtered = byClient.filter(
    (a) =>
      a.tag_no.toLowerCase().includes(search.toLowerCase()) ||
      (clientName(a.client_id) ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const speciesLabel = (value: string) =>
    SPECIES_OPTIONS.find((s) => s.value === value)?.label ?? value;

  const filterClient = clients.find((c) => c.id === clientFilter);

  return (
    <div>
      <PageHeader
        title="Gyvūnai"
        description={
          filterClient ? `Kliento „${filterClient.name}" gyvūnai` : "Gyvūnų registras ir pagrindiniai duomenys"
        }
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas gyvūnas
          </Button>
        }
      />

      {filterClient && (
        <Link href="/animals" className="mb-4 inline-block text-xs font-medium text-emerald-700 hover:underline">
          × Rodyti visus gyvūnus
        </Link>
      )}

      <div className="mb-4">
        <input
          placeholder="Ieškoti pagal numerį ar klientą..."
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
            <EmptyState message="Gyvūnų nerasta." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Numeris</th>
                <th className="px-5 py-3">Rūšis</th>
                <th className="px-5 py-3">Veislė</th>
                <th className="px-5 py-3">Gimimo data</th>
                <th className="px-5 py-3">Klientas</th>
                <th className="px-5 py-3">Būsena</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    {a.tag_no}
                    {a.name && <span className="ml-1.5 text-slate-500">({a.name})</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{speciesLabel(a.species)}</td>
                  <td className="px-5 py-3 text-slate-600">{a.breed ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(a.birth_date)}</td>
                  <td className="px-5 py-3 text-slate-600">{clientName(a.client_id) ?? "—"}</td>
                  <td className="px-5 py-3">
                    {a.active ? (
                      <Badge className="bg-emerald-50 text-emerald-700">Aktyvus</Badge>
                    ) : (
                      <Badge>Neaktyvus</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/visits?animal=${a.id}`}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Vizitai"
                        title="Vizitų istorija"
                      >
                        <Stethoscope size={16} />
                      </Link>
                      <button
                        onClick={() => openEdit(a)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Redaguoti"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(a)}
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
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Redaguoti gyvūną" : "Naujas gyvūnas"} wide>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Identifikacijos numeris"
              required
              value={form.tag_no}
              onChange={(e) => setForm({ ...form, tag_no: e.target.value })}
            />
            <Input
              label="Vardas (nebūtina)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Select
              label="Rūšis"
              value={form.species}
              onChange={(e) => setForm({ ...form, species: e.target.value })}
            >
              {SPECIES_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Input label="Lytis" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })} />
            <Input
              label="Veislė"
              value={form.breed}
              onChange={(e) => setForm({ ...form, breed: e.target.value })}
            />
          </div>
          <Input
            label="Gimimo data"
            type="date"
            value={form.birth_date}
            onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
          />
          <div className="flex items-end gap-1">
            <Select
              label="Klientas"
              wrapperClassName="flex-1"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            >
              <option value="">— Nenurodytas —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={() => setQuickClientOpen(true)}>
              <Plus size={16} />
            </Button>
          </div>
          <Textarea
            label="Pastabos"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Aktyvus gyvūnas
          </label>

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

      <Modal open={quickClientOpen} onClose={() => setQuickClientOpen(false)} title="Naujas klientas">
        <form onSubmit={handleQuickClientSubmit} className="space-y-3">
          <Input
            label="Pavadinimas"
            required
            value={quickClientForm.name}
            onChange={(e) => setQuickClientForm({ ...quickClientForm, name: e.target.value })}
          />
          <Input
            label="Adresas"
            value={quickClientForm.address}
            onChange={(e) => setQuickClientForm({ ...quickClientForm, address: e.target.value })}
          />
          <Input
            label="Telefonas"
            value={quickClientForm.phone}
            onChange={(e) => setQuickClientForm({ ...quickClientForm, phone: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setQuickClientOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={quickClientSaving}>
              {quickClientSaving ? "Saugoma..." : "Sukurti"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
