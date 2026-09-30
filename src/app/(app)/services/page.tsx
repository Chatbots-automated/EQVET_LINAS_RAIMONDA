"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Field";
import { formatMoney } from "@/lib/format";
import { centsToNumber, centsToString, toCents } from "@/lib/money";

type Service = Database["public"]["Tables"]["service_catalog"]["Row"];

const EMPTY_FORM = { name: "", price: "" };

// The vet's own price list of services — the "Paslauga" dropdown in the visit
// form, "Vizito užbaigimas" and the invoice draft is filled from here.
export default function ServicesPage() {
  const supabase = createClient();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("service_catalog").select("*").order("name");
    setServices(data ?? []);
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

  function openEdit(s: Service) {
    setEditing(s);
    setForm({ name: s.name, price: s.price != null ? centsToString(toCents(s.price) ?? 0) : "" });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = form.price.trim() ? toCents(form.price) : null;
    if (form.price.trim() && (cents === null || cents < 0)) return setError("Neteisinga kaina.");

    setSaving(true);
    const payload = { name: form.name.trim(), price: cents === null ? null : centsToNumber(cents) };
    const { error } = editing
      ? await supabase.from("service_catalog").update(payload).eq("id", editing.id)
      : await supabase.from("service_catalog").insert(payload);
    setSaving(false);
    if (error) {
      return setError(error.code === "23505" ? "Tokia paslauga sąraše jau yra." : error.message);
    }
    setModalOpen(false);
    load();
  }

  async function handleDelete(s: Service) {
    if (!confirm(`Pašalinti paslaugą „${s.name}“ iš sąrašo? Jau išsaugoti vizitai ir sąskaitos nepasikeis.`)) return;
    const { error } = await supabase.from("service_catalog").delete().eq("id", s.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  return (
    <div>
      <PageHeader
        title="Paslaugos"
        description="Paslaugų sąrašas su kainomis — iš jo renkatės pildydami vizitą ir sąskaitą."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Nauja paslauga
          </Button>
        }
      />

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : services.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Paslaugų dar nėra. Pridėkite čia arba įveskite jas užbaigdami vizitą — jos įsimins pačios." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Paslauga</th>
                  <th className="px-5 py-3 text-right">Kaina</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {services.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatMoney(s.price)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Redaguoti"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
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
        title={editing ? "Redaguoti paslaugą" : "Nauja paslauga"}
        icon={<Tags size={18} />}
        iconClassName="bg-amber-50 text-amber-700"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input label="Pavadinimas" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input
            label="Kaina, €"
            inputMode="decimal"
            placeholder="0.00"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
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
