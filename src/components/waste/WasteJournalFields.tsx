"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

type SettingsRow = Database["public"]["Tables"]["medical_waste_settings"]["Row"];
type Waste = Database["public"]["Tables"]["medical_waste"]["Row"];

export type WasteSettings = Pick<SettingsRow, "waste_code" | "waste_name" | "carrier" | "processor" | "responsible" | "doc_no">;

const EMPTY = { waste_code: "", waste_name: "", carrier: "", processor: "", responsible: "", doc_no: "" };
type FormState = typeof EMPTY;

const FIELDS: { key: keyof FormState; label: string; placeholder?: string }[] = [
  { key: "waste_code", label: "Atliekų kodas", placeholder: "Pvz. 18 02 03" },
  { key: "waste_name", label: "Atliekų pavadinimas", placeholder: "Pvz. Tuščios vaistų pakuotės" },
  { key: "carrier", label: "Vežėjas" },
  { key: "processor", label: "Tvarkytojas" },
  { key: "doc_no", label: "Sutarties / dokumento Nr." },
  { key: "responsible", label: "Atsakingas asmuo" },
];

/** A journal row with the fixed values filled in wherever the row itself leaves the column empty. */
export function withWasteDefaults(row: Waste, settings: WasteSettings | null): Waste {
  if (!settings) return row;
  return {
    ...row,
    carrier: row.carrier || settings.carrier,
    processor: row.processor || settings.processor,
    responsible: row.responsible || settings.responsible,
    doc_no: row.doc_no || settings.doc_no,
  };
}

/**
 * The fixed columns of the medical waste journal, typed in once: they are
 * used for every automatic entry and shown in every row that doesn't say
 * otherwise.
 */
export function WasteJournalFields({ onChange }: { onChange?: (settings: WasteSettings) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saved, setSaved] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .from("medical_waste_settings")
      .select("waste_code, waste_name, carrier, processor, responsible, doc_no")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const next = Object.fromEntries(FIELDS.map((f) => [f.key, data[f.key] ?? ""])) as FormState;
        setForm(next);
        setSaved(next);
        onChange?.(data);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = FIELDS.some((f) => form[f.key] !== saved[f.key]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key].trim() || null])) as WasteSettings;
    const { error } = await createClient().from("medical_waste_settings").upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) return setError(error.message);
    setSaved(form);
    onChange?.(payload);
  }

  return (
    <Card title="Žurnalo pastovūs duomenys" className="mb-4 [&>div:last-child]:p-4">
      <form onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Įvedama vieną kartą: šie duomenys įrašomi į automatinius įrašus ir rodomi žurnalo stulpeliuose, kur įraše nenurodyta kitaip.
          </p>
          <Button type="submit" size="sm" disabled={!dirty || saving}>
            {saving ? "Saugoma..." : dirty ? "Išsaugoti" : "Išsaugota"}
          </Button>
        </div>
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>
    </Card>
  );
}
