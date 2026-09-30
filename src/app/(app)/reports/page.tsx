"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DateField } from "@/components/ui/Field";
import { formatDate, formatMoney, formatQty, toISODate, todayISO as today } from "@/lib/format";
import { speciesLabel } from "@/lib/labels";
import { exportToCsv, exportToPdf } from "@/lib/export";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type Movement = Database["public"]["Views"]["stock_movements"]["Row"];
type Treated = Database["public"]["Views"]["vw_treated_animals_registry"]["Row"];
type DrugRow = Database["public"]["Views"]["vw_vet_drug_journal"]["Row"];
type BiocideReceipt = Database["public"]["Views"]["vw_biocide_receiving_journal"]["Row"];
type BiocideUse = Database["public"]["Views"]["vw_biocide_journal"]["Row"];

type Tab = "treated" | "drugs" | "biocides" | "visits" | "movements";

const TABS: { key: Tab; label: string; title: string }[] = [
  { key: "treated", label: "Gydomų gyvūnų registras", title: "Gydomų gyvūnų registracijos žurnalas" },
  { key: "drugs", label: "Vaistų žurnalas", title: "Veterinarinių vaistų ir vaistinių preparatų apskaitos žurnalas" },
  { key: "biocides", label: "Biocidų žurnalas", title: "Biocidinių produktų apskaitos žurnalas" },
  { key: "visits", label: "Vizitų suvestinė", title: "Vizitų suvestinė" },
  { key: "movements", label: "Atsargų judėjimas", title: "Atsargų judėjimo žurnalas" },
];

// The drug journal is a running per-batch ledger (open from receipt until the
// batch is used up), not a list of events in a period — so it is not
// date-filtered, otherwise batches received earlier but still being drawn
// down would disappear from the month's report.
const UNFILTERED_TABS: Tab[] = ["drugs"];

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
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    if (tab === "treated") {
      const { data } = await supabase
        .from("vw_treated_animals_registry")
        .select("*")
        .gte("registration_date", from)
        .lte("registration_date", to)
        .order("registration_date")
        .order("created_at");
      setTreated(data ?? []);
    } else if (tab === "drugs") {
      const { data } = await supabase
        .from("vw_vet_drug_journal")
        .select("*")
        .order("product_name")
        .order("receipt_date");
      setDrugs(data ?? []);
    } else if (tab === "biocides") {
      const [{ data: r }, { data: u }] = await Promise.all([
        supabase
          .from("vw_biocide_receiving_journal")
          .select("*")
          .lte("receipt_date", to)
          .order("biocide_name")
          .order("receipt_date"),
        supabase
          .from("vw_biocide_journal")
          .select("*")
          .gte("use_date", from)
          .lte("use_date", to)
          .order("biocide_name")
          .order("use_date")
          .order("created_at"),
      ]);
      setBiocideReceipts(r ?? []);
      setBiocideUses(u ?? []);
    } else if (tab === "visits") {
      const { data } = await supabase
        .from("visit_history_view")
        .select("*")
        .gte("visit_date", from)
        .lte("visit_date", to)
        .order("visit_date", { ascending: false });
      setVisits(data ?? []);
    } else {
      const { data } = await supabase
        .from("stock_movements")
        .select("*")
        .gte("movement_at", from)
        .lte("movement_at", `${to}T23:59:59`)
        .order("movement_at", { ascending: false });
      setMovements(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to]);

  const current = TABS.find((t) => t.key === tab)!;
  const dateFiltered = !UNFILTERED_TABS.includes(tab);
  const period = dateFiltered ? `${formatDate(from)} – ${formatDate(to)}` : `sugeneruota ${formatDate(today())}`;
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
            "Eil. Nr.", "Registracijos data", "Savininkas, adresas", "Rūšis", "Lytis", "Amžius", "Ženklinimo Nr.",
            "Pirmųjų požymių data", "Gyvūno būklė", "Atlikti tyrimai", "Klinikinė diagnozė",
            "Paslaugos, vaistai, dozės", "Ligos baigtis", "Vet. gydytojas",
          ],
          rows: treated.map((t, i) => [
            i + 1,
            formatDate(t.registration_date),
            [t.owner_name, t.owner_address].filter(Boolean).join(", "),
            speciesLabel(t.species),
            t.sex ?? "",
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
          headers: ["Data", "Tipas", "Produktas", "Kiekis", "Partija", "Tiekėjas / Gyvūnas", "Dok. Nr."],
          rows: movements.map((m) => [
            formatDate(m.movement_at),
            m.movement_type === "pajamavimas" ? "Pajamavimas" : "Nurašymas",
            m.product_name,
            formatQty(m.qty, m.unit),
            m.lot ?? "",
            m.supplier_name ?? m.animal_tag ?? "",
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-800">{current.title}</h2>
          {tab !== "drugs" && tab !== "biocides" && <p className="text-xs text-slate-500">{period}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dateFiltered && (
            <>
              {/* A half-typed date is ignored — the report keeps the last valid period. */}
              <div className="w-36">
                <DateField
                  value={from}
                  onChange={(v) => v && setFrom(v)}
                  aria-label="Nuo"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <span className="text-sm text-slate-400">–</span>
              <div className="w-36">
                <DateField
                  value={to}
                  onChange={(v) => v && setTo(v)}
                  aria-label="Iki"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
            </>
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
                  <th className={TH}>Eil. Nr.</th>
                  <th className={TH}>Reg. data</th>
                  <th className={TH}>Savininkas, adresas</th>
                  <th className={TH}>Gyvūnas</th>
                  <th className={TH}>Pirmųjų požymių data</th>
                  <th className={TH}>Būklė</th>
                  <th className={TH}>Tyrimai</th>
                  <th className={TH}>Klinikinė diagnozė</th>
                  <th className={TH}>Paslaugos, vaistai, dozės</th>
                  <th className={TH}>Ligos baigtis</th>
                  <th className={TH}>Vet. gydytojas</th>
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
                    <td className={TD}>
                      <div className="font-medium text-slate-900">
                        {t.animal_tag}
                        {t.animal_name ? ` · ${t.animal_name}` : ""}
                      </div>
                      <div className="text-slate-500">
                        {[speciesLabel(t.species), t.sex, ageAt(t.birth_date, t.registration_date)]
                          .filter((x) => x && x !== "—")
                          .join(", ")}
                      </div>
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
      ) : tab === "visits" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Gyvūnas</th>
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
