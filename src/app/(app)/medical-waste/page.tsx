"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DateInput, Input, Textarea } from "@/components/ui/Field";
import { formatDate, formatQty, todayISO } from "@/lib/format";
import { useProfileName } from "@/lib/profile";
import { Badge } from "@/components/ui/Badge";
import { WasteJournalFields, type WasteSettings } from "@/components/waste/WasteJournalFields";

type Waste = Database["public"]["Tables"]["medical_waste"]["Row"];

// The usual codes for a veterinary practice (Atliekų sąrašas, 18 02 grupė).
const WASTE_CODES = [
  { code: "18 02 01", name: "Aštrūs daiktai (adatos, skalpeliai)" },
  { code: "18 02 02*", name: "Atliekos, kurių rinkimui ir šalinimui taikomi specialūs reikalavimai (infekuotos)" },
  { code: "18 02 03", name: "Atliekos, kurių rinkimui ir šalinimui netaikomi specialūs reikalavimai" },
  { code: "18 02 05*", name: "Cheminės medžiagos, kuriose yra pavojingųjų medžiagų" },
  { code: "18 02 07*", name: "Citotoksiniai arba citostatiniai vaistai" },
  { code: "18 02 08", name: "Vaistai (pasibaigusio galiojimo, nebenaudojami)" },
];

function emptyForm(responsible = "") {
  return {
    waste_code: "",
    name: "",
    period: "",
    date: todayISO(),
    qty_generated: "",
    qty_transferred: "",
    carrier: "",
    processor: "",
    transfer_date: "",
    doc_no: "",
    responsible,
    notes: "",
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

// Veterinarinių medicininių atliekų susidarymo apskaitos žurnalas — data entry.
// The printable journal itself is in Ataskaitos.
export default function MedicalWastePage() {
  const supabase = createClient();
  const profileName = useProfileName();
  const [rows, setRows] = useState<Waste[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Waste | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<WasteSettings | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("medical_waste").select("*").order("date", { ascending: false }).order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    // A new manual entry starts from the journal's fixed values.
    setForm({
      ...emptyForm(settings?.responsible || profileName),
      waste_code: settings?.waste_code ?? "",
      name: settings?.waste_name ?? "",
      carrier: settings?.carrier ?? "",
      processor: settings?.processor ?? "",
      doc_no: settings?.doc_no ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  function openEdit(w: Waste) {
    setEditing(w);
    setForm({
      waste_code: w.waste_code,
      name: w.name,
      period: w.period ?? "",
      date: w.date,
      qty_generated: w.qty_generated?.toString() ?? "",
      qty_transferred: w.qty_transferred?.toString() ?? "",
      carrier: w.carrier ?? "",
      processor: w.processor ?? "",
      transfer_date: w.transfer_date ?? "",
      doc_no: w.doc_no ?? "",
      responsible: w.responsible ?? "",
      notes: w.notes ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const generated = num(form.qty_generated);
    const transferred = num(form.qty_transferred);
    if (!form.date) return setError("Įveskite datą.");
    if ([generated, transferred].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return setError("Neteisingas kiekis.");

    setSaving(true);
    const payload = {
      waste_code: form.waste_code.trim(),
      name: form.name.trim(),
      period: form.period.trim() || null,
      date: form.date,
      qty_generated: generated,
      qty_transferred: transferred,
      carrier: form.carrier.trim() || null,
      processor: form.processor.trim() || null,
      transfer_date: form.transfer_date || null,
      doc_no: form.doc_no.trim() || null,
      responsible: form.responsible.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("medical_waste").update(payload).eq("id", editing.id)
      : await supabase.from("medical_waste").insert(payload);
    setSaving(false);
    if (error) return setError(error.message);
    setModalOpen(false);
    load();
  }

  async function handleDelete(w: Waste) {
    if (!confirm(`Ištrinti atliekų įrašą ${w.waste_code} (${formatDate(w.date)})?`)) return;
    const { error } = await supabase.from("medical_waste").delete().eq("id", w.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  const totalGenerated = rows.reduce((s, w) => s + (w.qty_generated ?? 0), 0);
  const totalTransferred = rows.reduce((s, w) => s + (w.qty_transferred ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Medicininės atliekos"
        description="Tuščios pakuotės įsirašo automatiškai pagal produkto pakuotės dydį ir tuščios pakuotės svorį. Žurnalas spausdinimui — Ataskaitose."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> Naujas įrašas
          </Button>
        }
      />

      <WasteJournalFields onChange={setSettings} />

      {rows.length > 0 && (
        <p className="mb-4 text-sm text-slate-600">
          Susidarė <span className="font-semibold text-slate-900">{formatQty(totalGenerated, "kg")}</span> · perduota{" "}
          <span className="font-semibold text-slate-900">{formatQty(totalTransferred, "kg")}</span> · laikoma{" "}
          <span className="font-semibold text-slate-900">{formatQty(Math.max(0, totalGenerated - totalTransferred), "kg")}</span>
          <Link href="/reports" className="ml-3 font-medium text-emerald-700 hover:underline">
            Žurnalas Ataskaitose →
          </Link>
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Atliekų įrašų dar nėra. Produktuose nurodykite pakuotės dydį ir tuščios pakuotės svorį — įrašai atsiras patys, kai pakuotės ištuštės." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Kodas</th>
                  <th className="px-5 py-3">Pavadinimas</th>
                  <th className="px-5 py-3 text-right">Susidarė</th>
                  <th className="px-5 py-3 text-right">Perduota</th>
                  <th className="px-5 py-3">Tvarkytojas</th>
                  <th className="px-5 py-3">Perdavimo data</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                      {formatDate(w.date)}
                      {w.period && <div className="text-xs text-slate-400">{w.period}</div>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap font-medium text-slate-900">{w.waste_code}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {w.name}
                      {w.auto_generated && <Badge className="ml-2 bg-slate-100 text-slate-600">automatinis</Badge>}
                      {w.notes && <div className="text-xs text-slate-400">{w.notes}</div>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatQty(w.qty_generated, "kg")}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatQty(w.qty_transferred, "kg")}</td>
                    <td className="px-5 py-3 text-slate-600">{w.processor || settings?.processor || "—"}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{formatDate(w.transfer_date)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(w)} aria-label="Redaguoti" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(w)} aria-label="Ištrinti" className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600">
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
        title={editing ? "Redaguoti atliekų įrašą" : "Naujas atliekų įrašas"}
        icon={<Trash2 size={18} />}
        iconClassName="bg-orange-50 text-orange-600"
        wide
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Atliekų kodas"
              required
              list="waste-codes"
              placeholder="Pvz. 18 02 02*"
              value={form.waste_code}
              onChange={(e) => {
                const code = e.target.value;
                const known = WASTE_CODES.find((c) => c.code === code);
                // Picking a known code fills in its name (unless one was typed already).
                setForm({ ...form, waste_code: code, name: known && !form.name.trim() ? known.name : form.name });
              }}
            />
            <Input
              label="Atliekų pavadinimas"
              required
              wrapperClassName="sm:col-span-2"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <datalist id="waste-codes">
              {WASTE_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <DateInput label="Data" required value={form.date} onChange={(date) => setForm({ ...form, date })} />
            <Input
              label="Susidarymo periodas"
              placeholder="Pvz. 2026 m. rugsėjis"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            />
            <Input
              label="Susidarymo kiekis, kg"
              inputMode="decimal"
              value={form.qty_generated}
              onChange={(e) => setForm({ ...form, qty_generated: e.target.value })}
            />
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">Perdavimas atliekų tvarkytojui</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Perduotas kiekis, kg"
                inputMode="decimal"
                value={form.qty_transferred}
                onChange={(e) => setForm({ ...form, qty_transferred: e.target.value })}
              />
              <DateInput label="Perdavimo data" value={form.transfer_date} onChange={(transfer_date) => setForm({ ...form, transfer_date })} />
              <Input label="Dokumento Nr." value={form.doc_no} onChange={(e) => setForm({ ...form, doc_no: e.target.value })} />
              <Input label="Vežėjas" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
              <Input
                label="Tvarkytojas"
                wrapperClassName="sm:col-span-2"
                value={form.processor}
                onChange={(e) => setForm({ ...form, processor: e.target.value })}
              />
            </div>
          </div>

          <Input label="Atsakingas asmuo" value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} />
          <Textarea label="Pastabos" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

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
