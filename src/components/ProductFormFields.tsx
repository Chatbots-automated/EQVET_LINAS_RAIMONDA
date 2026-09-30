import type { ProductCategory, Unit } from "@/lib/database.types";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { CATEGORY_LABELS, UNIT_LABELS } from "@/lib/labels";

export interface ProductFormState {
  name: string;
  category: ProductCategory;
  unit: Unit;
  package_size: string;
  active_substance: string;
  registration_code: string;
  markup_percent: string;
  notes: string;
  is_active: boolean;
}

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "",
  category: "medicines",
  unit: "ml",
  package_size: "",
  active_substance: "",
  registration_code: "",
  markup_percent: "",
  notes: "",
  is_active: true,
};

export function productFormToPayload(form: ProductFormState) {
  return {
    name: form.name.trim(),
    category: form.category,
    unit: form.unit,
    package_size: form.package_size ? Number(form.package_size) : null,
    active_substance: form.active_substance.trim() || null,
    registration_code: form.registration_code.trim() || null,
    markup_percent: form.markup_percent.trim() ? Number(form.markup_percent.replace(",", ".")) : null,
    notes: form.notes.trim() || null,
    is_active: form.is_active,
  };
}

// Shared by the Products page's create/edit modal and Pajamavimas' quick
// "Sukurti naują produktą" flow, so both offer the same complete field set
// instead of drifting apart.
export function ProductFormFields({
  form,
  onChange,
  showActiveToggle = true,
}: {
  form: ProductFormState;
  onChange: (form: ProductFormState) => void;
  showActiveToggle?: boolean;
}) {
  return (
    <>
      <Input
        label="Pavadinimas"
        required
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Kategorija"
          value={form.category}
          onChange={(e) => onChange({ ...form, category: e.target.value as ProductCategory })}
        >
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Matavimo vienetas"
          value={form.unit}
          onChange={(e) => onChange({ ...form, unit: e.target.value as Unit })}
        >
          {Object.entries(UNIT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Pakuotės dydis"
          type="number"
          step="any"
          value={form.package_size}
          onChange={(e) => onChange({ ...form, package_size: e.target.value })}
        />
        <Input
          label="Veiklioji medžiaga"
          value={form.active_substance}
          onChange={(e) => onChange({ ...form, active_substance: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Registracijos kodas"
          value={form.registration_code}
          onChange={(e) => onChange({ ...form, registration_code: e.target.value })}
        />
        <Input
          label="Antkainis, %"
          type="number"
          step="any"
          min="0"
          placeholder="Pvz. 10"
          value={form.markup_percent}
          onChange={(e) => onChange({ ...form, markup_percent: e.target.value })}
        />
      </div>
      <Textarea label="Pastabos" value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      {showActiveToggle && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => onChange({ ...form, is_active: e.target.checked })}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Aktyvus produktas
        </label>
      )}
    </>
  );
}
