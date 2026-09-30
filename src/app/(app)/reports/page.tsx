"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DateInput, SearchSelect } from "@/components/ui/Field";
import { formatDate, formatMoney, formatQty, toISODate, todayISO as today } from "@/lib/format";
import { speciesLabel } from "@/lib/labels";
import { exportToCsv, exportToPdf } from "@/lib/export";
import { WasteJournalFields, withWasteDefaults, type WasteSettings } from "@/components/waste/WasteJournalFields";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type Movement = Database["public"]["Views"]["stock_movements"]["Row"];
type Treated = Database["public"]["Views"]["vw_treated_animals_registry"]["Row"];
type DrugRow = Database["public"]["Views"]["vw_vet_drug_journal"]["Row"];
type BiocideReceipt = Database["public"]["Views"]["vw_biocide_receiving_journal"]["Row"];
type BiocideUse = Database["public"]["Views"]["vw_biocide_journal"]["Row"];
type Waste = Database["public"]["Tables"]["medical_waste"]["Row"];
type ClientRow = Pick<Database["public"]["Tables"]["clients"]["Row"], "id" | "name">;
type AnimalRow = Pick<Database["public"]["Tables"]["animals"]["Row"], "id" | "tag_no" | "name" | "client_id">;
type ProductRow = Pick<Database["public"]["Tables"]["products"]["Row"], "id" | "name" | "category">;

type Tab = "treated" | "drugs" | "biocides" | "waste" | "visits" | "movements";
type FilterKey = "date" | "client" | "animal" | "product";

const TABS: { key: Tab; label: string; title: string }[] = [
  { key: "treated", label: "Gydomų gyvūnų registras", title: "Gydomų gyvūnų registracijos žurnalas" },
  { key: "drugs", label: "Vaistų žurnalas", title: "Veterinarinių vaistų ir vaistinių preparatų apskaitos žurnalas" },
  { key: "biocides", label: "Biocidų žurnalas", title: "Biocidinių produktų apskaitos žurnalas" },
  { key: "waste", label: "Medicininių atliekų žurnalas", title: "Veterinarinių medicininių atliekų susidarymo apskaitos žurnalas" },
  { key: "visits", label: "Vizitų suvestinė", title: "Vizitų suvestinė" },
  { key: "movements", label: "Atsargų judėjimas", title: "Atsargų judėjimo žurnalas" },
];

// The drug journal is a running per-batch ledger (open from receipt until the
// batch is used up), not a list of events in a period — so it is not
// date-filtered, otherwise batches received earlier but still being drawn
// down would disappear from the month's report.
//
// Which filters make sense for each journal. Client / animal only apply where
// a row belongs to a visit; receiving rows and the waste journal have no client.
const TAB_FILTERS: Record<Tab, FilterKey[]> = {
  treated: ["date", "client", "animal", "product"],
  drugs: ["product"],
  biocides: ["date", "client", "product"],
  waste: ["date"],
  visits: ["date", "client", "animal", "product"],
  movements: ["date", "client", "product"],
};

function firstOfMonth() {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function ageAt(birthDate: string | null, at: string) {
  if (!birthDate) return "—";
  const b = new Date(birthDate);
  const d = new Date(at);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months -= 1;
  if (months < 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y} m. ${m} mėn.`;
  return y ? `${y} m.` : `${m} mėn.`;
}

function docLabel(r: { supplier_name: string | null; doc_title: string | null; doc_number: string | null; doc_date: string | null }) {
  return (
    [r.supplier_name, r.doc_title, r.doc_number ? `Nr. ${r.doc_number}` : null, r.doc_date ? formatDate(r.doc_date) : null]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

function groupByProduct<T extends { product_id: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push(r);
    map.set(r.product_id, list);
  }
  return map;
}

const TH = "border border-slate-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const TD = "border border-slate-200 px-3 py-2 align-top text-slate-700";

export default function ReportsPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("treated");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  const [treated, setTreated] = useState<Treated[]>([]);
  const [drugs, setDrugs] = useState<DrugRow[]>([]);
  const [biocideReceipts, setBiocideReceipts] = useState<BiocideReceipt[]>([]);
  const [biocideUses, setBiocideUses] = useState<BiocideUse[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [wasteRows, setWaste] = useState<Waste[]>([]);
  const [wasteSettings, setWasteSettings] = useState<WasteSettings | null>(null);
  // Columns a row leaves empty show the journal's fixed values.
  const waste = wasteRows.map((w) => withWasteDefaults(w, wasteSettings));
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [productId, setProductId] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("animals").select("id, tag_no, name, client_id").order("tag_no"),
      supabase.from("products").select("id, name, category").order("name"),
    ]).then(([{ data: c }, { data: a }, { data: p }]) => {
      setClients(c ?? []);
      setAnimals(a ?? []);
      setProducts(p ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applies = (k: FilterKey) => TAB_FILTERS[tab].includes(k);
  // A filter that the current journal doesn't support is simply not applied.
  const fClient = applies("client") ? clientId : "";
  const fAnimal = applies("animal") ? animalId : "";
  const fProduct = applies("product") ? productId : "";

  async function load() {
    setLoading(true);
    if (tab === "treated") {
      let q = supabase.from("vw_treated_animals_registry").select("*").gte("registration_date", from).lte("registration_date", to);
      if (fClient) q = q.eq("client_id", fClient);
      if (fAnimal) q = q.eq("animal_id", fAnimal);
      if (fProduct) q = q.contains("product_ids", [fProduct]);
      const { data } = await q.order("registration_date").order("created_at");
      setTreated(data ?? []);
    } else if (tab === "drugs") {
      let q = supabase.from("vw_vet_drug_journal").select("*");
      if (fProduct) q = q.eq("product_id", fProduct);
      const { data } = await q.order("product_name").order("receipt_date");
      setDrugs(data ?? []);
    } else if (tab === "biocides") {
      let rq = supabase.from("vw_biocide_receiving_journal").select("*").lte("receipt_date", to);
      let uq = supabase.from("vw_biocide_journal").select("*").gte("use_date", from).lte("use_date", to);
      if (fProduct) {
        rq = rq.eq("product_id", fProduct);
        uq = uq.eq("product_id", fProduct);
      }
      if (fClient) uq = uq.eq("client_id", fClient);
      const [{ data: r }, { data: u }] = await Promise.all([
        rq.order("biocide_name").order("receipt_date"),
        uq.order("biocide_name").order("use_date").order("created_at"),
      ]);
      // With a client chosen only that client's uses matter — receipts of other products are noise.
      const usedProducts = new Set((u ?? []).map((x) => x.product_id));
      setBiocideReceipts(fClient ? (r ?? []).filter((x) => usedProducts.has(x.product_id)) : r ?? []);
      setBiocideUses(u ?? []);
    } else if (tab === "waste") {
      const { data } = await supabase.from("medical_waste").select("*").gte("date", from).lte("date", to).order("date").order("created_at");
      setWaste(data ?? []);
    } else if (tab === "visits") {
      let q = supabase.from("visit_history_view").select("*").gte("visit_date", from).lte("visit_date", to);
      if (fClient) q = q.eq("client_id", fClient);
      if (fAnimal) q = q.eq("animal_id", fAnimal);
      const { data } = await q.order("visit_date", { ascending: false });
      setVisits((data ?? []).filter((v) => !fProduct || v.products_used.some((p) => p.product_id === fProduct)));
    } else {
      let q = supabase.from("stock_movements").select("*").gte("movement_at", from).lte("movement_at", `${to}T23:59:59`);
      if (fClient) q = q.eq("client_id", fClient);
      if (fProduct) q = q.eq("product_id", fProduct);
      const { data } = await q.order("movement_at", { ascending: false });
      setMovements(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, fClient, fAnimal, fProduct]);

  const current = TABS.find((t) => t.key === tab)!;
  const dateFiltered = applies("date");
  const clientName = clients.find((c) => c.id === fClient)?.name;
  const animalTag = animals.find((a) => a.id === fAnimal)?.tag_no;
  const productName = products.find((p) => p.id === fProduct)?.name;
  // Shown under the title and printed on the PDF, so a filtered journal always says what it covers.
  const period = [
    dateFiltered ? `${formatDate(from)} – ${formatDate(to)}` : `sugeneruota ${formatDate(today())}`,
    clientName && `klientas: ${clientName}`,
    animalTag && `gyvūnas: ${animalTag}`,
    productName && `produktas: ${productName}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const clientAnimals = clientId ? animals.filter((a) => a.client_id === clientId) : animals;
  // Drug journal lists medicines + vaccines; biocide journal only biocides.
  const productOptions = products.filter((p) =>
    tab === "drugs" ? p.category === "medicines" || p.category === "vaccines" : tab === "biocides" ? p.category === "biocides" : true
  );
  const anyFilter = !!(fClient || fAnimal || fProduct);
  const fileBase = `${current.label.toLowerCase().replace(/\s+/g, "-")}_${dateFiltered ? `${from}_${to}` : today()}`;

  // Biocide rows shown per product: every product with a receipt up to `to`
  // or a use within the period.
  const biocideProducts = (() => {
    const names = new Map<string, { name: string; unit: string; reg: string | null; substance: string | null }>();
    for (const r of biocideReceipts)
      names.set(r.product_id, { name: r.biocide_name, unit: r.unit, reg: r.registration_code, substance: r.active_substance });
    for (const u of biocideUses)
      if (!names.has(u.product_id))
        names.set(u.product_id, { name: u.biocide_name, unit: u.unit, reg: u.registration_code, substance: u.active_substance });
    return [...names.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "lt"));
  })();
  const receiptsByProduct = groupByProduct(biocideReceipts);
  const usesByProduct = groupByProduct(biocideUses);
  const drugsByProduct = [...groupByProduct(drugs).entries()];

  function exportTable(): { headers: string[]; rows: (string | number)[][] } {
    switch (tab) {
      case "treated":
        return {
          headers: [
            "1. Eil. Nr.", "2. Registracijos data", "3. Gyvūno laikytojas, adresas", "4. Rūšis, lytis", "5. Amžius", "6. Ženklinimo Nr.",
            "7. Pirmųjų ligos požymių data", "8. Gyvūno būklė", "9. Atlikti tyrimai", "10. Klinikinė diagnozė",
            "11. Suteiktos veterinarijos paslaugos (vaistai, dozės)", "12. Ligos baigtis", "13. Veterinarijos gydytojas",
          ],
          rows: treated.map((t, i) => [
            i + 1,
            formatDate(t.registration_date),
            [t.owner_name, t.owner_address].filter(Boolean).join(", "),
            [speciesLabel(t.species), t.sex].filter((x) => x && x !== "—").join(", "),
            ageAt(t.birth_date, t.registration_date),
            t.animal_tag,
            t.first_symptoms_date ? formatDate(t.first_symptoms_date) : "",
            t.animal_condition ?? "",
            t.tests ?? "",
            t.clinical_diagnosis ?? "",
            [t.services, t.medicines].filter(Boolean).join("; "),
            t.outcome ?? "",
            t.veterinarian ?? "",
          ]),
        };
      case "drugs":
        return {
          headers: [
            "Vaistas", "Reg. kodas", "Gavimo data", "Dokumentas", "Gautas kiekis",
            "Tinka iki", "Serija", "Sunaudota", "Likutis", "Mato vnt.",
          ],
          rows: drugs.map((d) => [
            d.product_name,
            d.registration_code ?? "",
            formatDate(d.receipt_date),
            docLabel(d),
            d.quantity_received,
            d.expiry_date ? formatDate(d.expiry_date) : "",
            d.batch_number ?? "",
            d.quantity_used,
            d.quantity_remaining,
            d.unit,
          ]),
        };
      case "biocides":
        return {
          headers: [
            "Biocidas", "Įrašas", "Data", "Dokumentas / paskirtis", "Darbų apimtis",
            "Gauta", "Sunaudota", "Likutis", "Pagaminimo data", "Tinka iki", "Serija", "Naudojo",
          ],
          rows: biocideProducts.flatMap(([id, p]) => [
            ...(receiptsByProduct.get(id) ?? []).map((r) => [
              p.name, "Gavimas", formatDate(r.receipt_date), docLabel(r), "",
              formatQty(r.quantity_received, r.unit), "", "",
              r.mfg_date ? formatDate(r.mfg_date) : "", r.expiry_date ? formatDate(r.expiry_date) : "",
              r.batch_number ?? "", "",
            ]),
            ...(usesByProduct.get(id) ?? []).map((u) => [
              p.name, "Panaudojimas", formatDate(u.use_date), u.purpose ?? "", u.work_scope ?? "",
              "", formatQty(u.quantity_used, u.unit), formatQty(u.quantity_remaining, u.unit),
              "", u.batch_expiry ? formatDate(u.batch_expiry) : "", u.batch_number ?? "", u.applied_by ?? "",
            ]),
          ]),
        };
      case "waste":
        return {
          headers: [
            "Atliekų kodas", "Atliekų pavadinimas", "Susidarymo periodas", "Data", "Susidarymo kiekis, kg", "Perduotas kiekis, kg",
            "Vežėjas", "Tvarkytojas", "Perdavimo data", "Dokumento Nr.", "Atsakingas asmuo",
          ],
          rows: waste.map((w) => [
            w.waste_code, w.name, w.period ?? "", formatDate(w.date), w.qty_generated ?? "", w.qty_transferred ?? "",
            w.carrier ?? "", w.processor ?? "", w.transfer_date ? formatDate(w.transfer_date) : "", w.doc_no ?? "", w.responsible ?? "",
          ]),
        };
      case "visits":
        return {
          headers: ["Data", "Gyvūnas", "Klientas", "Priežastis", "Diagnozė", "Paslaugos", "Paslaugų kaina", "Vaistų kaina", "Iš viso", "Gydytojas", "Produktai"],
          rows: visits.map((v) => [
            formatDate(v.visit_date),
            v.animal_tag ?? "",
            v.client_name ?? "",
            v.reason ?? "",
            v.diagnosis ?? "",
            v.services ?? "",
            formatMoney(v.service_price),
            formatMoney(v.medicines_total),
            formatMoney(v.total_price),
            v.vet_name ?? "",
            v.products_used.map((p) => `${p.product_name} ${formatQty(p.quantity, p.unit)}`).join(", "),
          ]),
        };
      case "movements":
        return {
          headers: ["Data", "Tipas", "Produktas", "Kiekis", "Partija", "Tiekėjas / Gyvūnas", "Klientas", "Dok. Nr."],
          rows: movements.map((m) => [
            formatDate(m.movement_at),
            m.movement_type === "pajamavimas" ? "Pajamavimas" : "Nurašymas",
            m.product_name,
            formatQty(m.qty, m.unit),
            m.lot ?? "",
            m.supplier_name ?? m.animal_tag ?? "",
            m.client_name ?? "",
            m.doc_number ?? "",
          ]),
        };
    }
  }

  function handleExportCsv() {
    const { headers, rows } = exportTable();
    exportToCsv(`${fileBase}.csv`, headers, rows);
  }

  function handleExportPdf() {
    const { headers, rows } = exportTable();
    exportToPdf(`${fileBase}.pdf`, `${current.title} · ${period}`, headers, rows);
  }

  const isEmpty =
    (tab === "treated" && treated.length === 0) ||
    (tab === "drugs" && drugs.length === 0) ||
    (tab === "biocides" && biocideProducts.length === 0) ||
    (tab === "waste" && waste.length === 0) ||
    (tab === "visits" && visits.length === 0) ||
    (tab === "movements" && movements.length === 0);

  return (
    <div>
      <PageHeader title="Ataskaitos" />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === t.key ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="mb-4 [&>div]:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* A half-typed date is ignored — the journal keeps the last valid period. */}
          {applies("date") && (
            <>
              <DateInput label="Nuo" value={from} onChange={(v) => v && setFrom(v)} max={to} />
              <DateInput label="Iki" value={to} onChange={(v) => v && setTo(v)} min={from} />
            </>
          )}
          {applies("client") && (
            <SearchSelect
              label="Klientas"
              placeholder="Visi klientai"
              value={clientId}
              onChange={(id) => {
                setClientId(id);
                // The chosen animal must belong to the chosen client.
                if (id && animals.find((a) => a.id === animalId)?.client_id !== id) setAnimalId("");
              }}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          {applies("animal") && (
            <SearchSelect
              label="Gyvūnas"
              placeholder="Visi gyvūnai"
              value={animalId}
              onChange={setAnimalId}
              options={clientAnimals.map((a) => ({
                value: a.id,
                label: [a.tag_no, a.name].filter(Boolean).join(" · "),
                hint: clients.find((c) => c.id === a.client_id)?.name,
              }))}
            />
          )}
          {applies("product") && (
            <SearchSelect
              label={tab === "biocides" ? "Biocidas" : tab === "drugs" ? "Vaistas" : "Produktas"}
              placeholder="Visi"
              value={productOptions.some((p) => p.id === productId) ? productId : ""}
              onChange={setProductId}
              options={productOptions.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </div>
        {tab === "drugs" && (
          <p className="mt-2 text-xs text-slate-500">
            Vaistų žurnalas vedamas pagal partijas (gauta / sunaudota / likutis), todėl laikotarpio ir kliento filtrai jam netaikomi.
          </p>
        )}
        {tab === "waste" && (
          <p className="mt-2 text-xs text-slate-500">
            Įrašai atsiranda automatiškai, kai ištuštėja pakuotė (produkte nurodytas pakuotės dydis ir tuščios pakuotės svoris).
            Rankiniai įrašai ir perdavimas tvarkytojui —{" "}
            <Link href="/medical-waste" className="font-medium text-emerald-700 hover:underline">
              Atliekos
            </Link>
            .
          </p>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-800">{current.title}</h2>
          <p className="text-xs text-slate-500">{period}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {anyFilter && (
            <button
              onClick={() => {
                setClientId("");
                setAnimalId("");
                setProductId("");
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Rodyti visus ×
            </button>
          )}
          <button
            onClick={handleExportCsv}
            disabled={loading || isEmpty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download size={14} /> CSV
          </button>
          <button
            onClick={handleExportPdf}
            disabled={loading || isEmpty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            <FileText size={14} /> PDF
          </button>
        </div>
      </div>

      {tab === "waste" && <WasteJournalFields onChange={setWasteSettings} />}

      {loading ? (
        <Card>
          <div className="text-sm text-slate-500">Kraunama...</div>
        </Card>
      ) : isEmpty ? (
        <Card>
          <EmptyState message="Nėra įrašų šiai ataskaitai." />
        </Card>
      ) : tab === "treated" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>1. Eil. Nr.</th>
                  <th className={TH}>2. Registracijos data</th>
                  <th className={TH}>3. Gyvūno laikytojas, adresas</th>
                  <th className={TH}>4. Rūšis, lytis</th>
                  <th className={TH}>5. Amžius</th>
                  <th className={TH}>6. Ženklinimo Nr.</th>
                  <th className={TH}>7. Pirmųjų ligos požymių data</th>
                  <th className={TH}>8. Gyvūno būklė</th>
                  <th className={TH}>9. Atlikti tyrimai</th>
                  <th className={TH}>10. Klinikinė diagnozė</th>
                  <th className={TH}>11. Suteiktos veterinarijos paslaugos (vaistai, dozės)</th>
                  <th className={TH}>12. Ligos baigtis</th>
                  <th className={TH}>13. Veterinarijos gydytojas</th>
                </tr>
              </thead>
              <tbody>
                {treated.map((t, i) => (
                  <tr key={t.visit_id} className="hover:bg-slate-50">
                    <td className={TD}>{i + 1}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(t.registration_date)}</td>
                    <td className={TD}>
                      <div className="font-medium text-slate-900">{t.owner_name ?? "—"}</div>
                      {t.owner_address && <div className="text-slate-500">{t.owner_address}</div>}
                    </td>
                    <td className={TD}>{[speciesLabel(t.species), t.sex].filter((x) => x && x !== "—").join(", ") || "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{ageAt(t.birth_date, t.registration_date)}</td>
                    <td className={TD}>
                      <div className="font-medium text-slate-900">{t.animal_tag}</div>
                      {t.animal_name && <div className="text-slate-500">{t.animal_name}</div>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(t.first_symptoms_date)}</td>
                    <td className={TD}>{t.animal_condition || "—"}</td>
                    <td className={TD}>{t.tests || "—"}</td>
                    <td className={TD}>{t.clinical_diagnosis || "—"}</td>
                    <td className={TD}>
                      {t.services && <div>{t.services}</div>}
                      {t.medicines && <div className="text-slate-900">{t.medicines}</div>}
                      {!t.services && !t.medicines && "—"}
                    </td>
                    <td className={TD}>{t.outcome || "—"}</td>
                    <td className={TD}>{t.veterinarian || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "drugs" ? (
        <div className="space-y-4">
          {drugsByProduct.map(([id, rows]) => {
            const p = rows[0];
            const sum = (k: "quantity_received" | "quantity_used" | "quantity_remaining") =>
              rows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0);
            return (
              <Card key={id} className="overflow-hidden">
                <ProductHeader name={p.product_name} unit={p.unit} reg={p.registration_code} substance={p.active_substance} />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={TH}>Gavimo data</th>
                        <th className={TH}>Dokumentas (pavadinimas, Nr., data)</th>
                        <th className={TH}>Gautas kiekis</th>
                        <th className={TH}>Tinkamumo laikas</th>
                        <th className={TH}>Serija</th>
                        <th className={TH}>Sunaudotas kiekis</th>
                        <th className={TH}>Likutis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.batch_id} className="hover:bg-slate-50">
                          <td className={`${TD} whitespace-nowrap`}>{formatDate(r.receipt_date)}</td>
                          <td className={TD}>{docLabel(r)}</td>
                          <td className={TD}>{formatQty(r.quantity_received)}</td>
                          <td
                            className={`${TD} whitespace-nowrap ${
                              r.expiry_date && r.expiry_date < today() ? "font-medium text-red-600" : ""
                            }`}
                          >
                            {formatDate(r.expiry_date)}
                          </td>
                          <td className={TD}>{r.batch_number ?? "—"}</td>
                          <td className={TD}>{formatQty(r.quantity_used)}</td>
                          <td className={`${TD} font-medium text-slate-900`}>{formatQty(r.quantity_remaining)}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold">
                        <td className={TD} colSpan={2}>
                          Iš viso
                        </td>
                        <td className={TD}>{formatQty(sum("quantity_received"))}</td>
                        <td className={TD} colSpan={2}></td>
                        <td className={TD}>{formatQty(sum("quantity_used"))}</td>
                        <td className={TD}>{formatQty(sum("quantity_remaining"))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      ) : tab === "biocides" ? (
        <div className="space-y-4">
          {biocideProducts.map(([id, p]) => {
            const receipts = receiptsByProduct.get(id) ?? [];
            const uses = usesByProduct.get(id) ?? [];
            return (
              <Card key={id} className="overflow-hidden">
                <ProductHeader name={p.name} unit={p.unit} reg={p.reg} substance={p.substance} />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={TH}>Gavimo data</th>
                        <th className={TH}>Dokumentas (pavadinimas, Nr., data)</th>
                        <th className={TH}>Gautas kiekis</th>
                        <th className={TH}>Pagaminimo data</th>
                        <th className={TH}>Tinkamumo laikas</th>
                        <th className={TH}>Serija, partija</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.length === 0 ? (
                        <tr>
                          <td className={`${TD} text-center text-slate-400`} colSpan={6}>
                            Gavimų nėra
                          </td>
                        </tr>
                      ) : (
                        receipts.map((r) => (
                          <tr key={r.batch_id} className="hover:bg-slate-50">
                            <td className={`${TD} whitespace-nowrap`}>{formatDate(r.receipt_date)}</td>
                            <td className={TD}>{docLabel(r)}</td>
                            <td className={TD}>{formatQty(r.quantity_received, r.unit)}</td>
                            <td className={`${TD} whitespace-nowrap`}>{formatDate(r.mfg_date)}</td>
                            <td className={`${TD} whitespace-nowrap`}>{formatDate(r.expiry_date)}</td>
                            <td className={TD}>{r.batch_number ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <table className="mt-3 w-full border-collapse text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={TH}>Panaudojimo data</th>
                        <th className={TH}>Panaudojimo paskirtis</th>
                        <th className={TH}>Darbų apimtis</th>
                        <th className={TH}>Sunaudotas kiekis</th>
                        <th className={TH}>Likutis</th>
                        <th className={TH}>Naudojusio asmens vardas, pavardė</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uses.length === 0 ? (
                        <tr>
                          <td className={`${TD} text-center text-slate-400`} colSpan={6}>
                            Panaudojimų per laikotarpį nėra
                          </td>
                        </tr>
                      ) : (
                        uses.map((u) => (
                          <tr key={u.entry_id} className="hover:bg-slate-50">
                            <td className={`${TD} whitespace-nowrap`}>{formatDate(u.use_date)}</td>
                            <td className={TD}>
                              {u.purpose || "—"}
                              {u.visit_id && <Badge className="ml-1.5 bg-rose-50 text-rose-700">Vizitas</Badge>}
                            </td>
                            <td className={TD}>{u.work_scope || "—"}</td>
                            <td className={TD}>{formatQty(u.quantity_used, u.unit)}</td>
                            <td className={`${TD} font-medium text-slate-900`}>{formatQty(u.quantity_remaining, u.unit)}</td>
                            <td className={TD}>{u.applied_by || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      ) : tab === "waste" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Atliekų kodas</th>
                  <th className={TH}>Atliekų pavadinimas</th>
                  <th className={TH}>Susidarymo periodas / data</th>
                  <th className={TH}>Susidarymo kiekis</th>
                  <th className={TH}>Perduotas kiekis</th>
                  <th className={TH}>Vežėjas</th>
                  <th className={TH}>Tvarkytojas</th>
                  <th className={TH}>Perdavimo data</th>
                  <th className={TH}>Dokumento Nr.</th>
                  <th className={TH}>Atsakingas asmuo</th>
                </tr>
              </thead>
              <tbody>
                {waste.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className={`${TD} whitespace-nowrap font-medium text-slate-900`}>{w.waste_code}</td>
                    <td className={TD}>
                      {w.name}
                      {w.notes && <div className="text-slate-500">{w.notes}</div>}
                    </td>
                    <td className={TD}>
                      {w.period && <div>{w.period}</div>}
                      <div className="whitespace-nowrap">{formatDate(w.date)}</div>
                    </td>
                    <td className={TD}>{formatQty(w.qty_generated, "kg")}</td>
                    <td className={TD}>{formatQty(w.qty_transferred, "kg")}</td>
                    <td className={TD}>{w.carrier || "—"}</td>
                    <td className={TD}>{w.processor || "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(w.transfer_date)}</td>
                    <td className={TD}>{w.doc_no || "—"}</td>
                    <td className={TD}>{w.responsible || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "visits" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Gyvūnas</th>
                  <th className="px-5 py-3">Klientas</th>
                  <th className="px-5 py-3">Priežastis / Diagnozė</th>
                  <th className="px-5 py-3">Produktai</th>
                  <th className="px-5 py-3">Kaina</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((v) => (
                  <tr key={v.visit_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">{formatDate(v.visit_date)}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{v.animal_tag ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{v.client_name ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{v.reason || v.diagnosis || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {v.products_used.map((p) => `${p.product_name} (${formatQty(p.quantity, p.unit)})`).join(", ") || "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatMoney(v.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Tipas</th>
                  <th className="px-5 py-3">Produktas</th>
                  <th className="px-5 py-3">Kiekis</th>
                  <th className="px-5 py-3">Partija</th>
                  <th className="px-5 py-3">Tiekėjas / Gyvūnas</th>
                  <th className="px-5 py-3">Klientas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.movement_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">{formatDate(m.movement_at)}</td>
                    <td className="px-5 py-3">
                      <Badge
                        className={
                          m.movement_type === "pajamavimas" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                        }
                      >
                        {m.movement_type === "pajamavimas" ? "Pajamavimas" : "Nurašymas"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">{m.product_name}</td>
                    <td className="px-5 py-3 text-slate-600">{formatQty(m.qty, m.unit)}</td>
                    <td className="px-5 py-3 text-slate-600">{m.lot ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{m.supplier_name ?? m.animal_tag ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{m.client_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ProductHeader({
  name,
  unit,
  reg,
  substance,
}: {
  name: string;
  unit: string;
  reg: string | null;
  substance: string | null;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{name}</div>
        <div className="mt-0.5 space-x-3 text-xs text-slate-500">
          {reg && <span>Reg. kodas: {reg}</span>}
          {substance && <span>Veiklioji medžiaga: {substance}</span>}
        </div>
      </div>
      <div className="text-xs text-slate-500">
        Mato vnt.: <span className="font-medium text-slate-700">{unit}</span>
      </div>
    </div>
  );
}
