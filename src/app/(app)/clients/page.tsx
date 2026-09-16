"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, PawPrint, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Field";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

const EMPTY_FORM = { name: "", address: "", phone: "", email: "", notes: "" };

export default function ClientsPage() {
  const supabase = createClient();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [animalCounts, setAnimalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: animals }] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("animals").select("client_id").not("client_id", "is", null),
    ]);
    setClients(c ?? []);
    const counts: Record<string, number> = {};
    for (const a of animals ?? []) {
      if (a.client_id) counts[a.client_id] = (counts[a.client_id] ?? 0) + 1;
    }
    setAnimalCounts(counts);
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

  function openEdit(c: ClientRow) {
    setEditing(c);
    setForm({
      name: c.name,
      address: c.address ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    };

    const { error } = editing
      ? await supabase.from("clients").update(payload).eq("id", editing.id)
      : await supabase.from("clients").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setModalOpen(false);
    load();
  }

  async function handleDelete(c: ClientRow) {
    if (!confirm(`Ištrinti klientą "${c.name}"? Susieti gyvūnai liks, bet be kliento.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Klientai"
        description="Gyvūnų savininkai / ūkiai"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas klientas
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
            <EmptyState message="Klientų dar nėra. Pridėkite pirmąjį." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Pavadinimas</th>
                <th className="px-5 py-3">Adresas</th>
                <th className="px-5 py-3">Telefonas</th>
                <th className="px-5 py-3">El. paštas</th>
                <th className="px-5 py-3">Gyvūnai</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-5 py-3 text-slate-600">{c.address ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{animalCounts[c.id] ?? 0}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/animals?client=${c.id}`}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Gyvūnai"
                      >
                        <PawPrint size={16} />
                      </Link>
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Redaguoti"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Redaguoti klientą" : "Naujas klientas"}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="Pavadinimas"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Adresas"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Telefonas"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="El. paštas"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <Textarea
            label="Pastabos"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

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
