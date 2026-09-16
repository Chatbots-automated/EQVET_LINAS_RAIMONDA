"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { exportToCsv, exportToPdf } from "@/lib/export";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type Movement = Database["public"]["Views"]["stock_movements"]["Row"];

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"visits" | "movements">("visits");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  const [visits, setVisits] = useState<Visit[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    if (tab === "visits") {
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

  function handleExportCsv() {
    if (tab === "visits") {
      exportToCsv(
        `gydymu-zurnalas_${from}_${to}.csv`,
        ["Data", "Gyvūnas", "Klientas", "Priežastis", "Diagnozė", "Paslaugos", "Kaina", "Gydytojas", "Produktai"],
        visits.map((v) => [
          formatDate(v.visit_date),
          v.animal_tag ?? "",
          v.client_name ?? "",
          v.reason ?? "",
          v.diagnosis ?? "",
          v.services ?? "",
          v.service_price ?? "",
          v.vet_name ?? "",
          v.products_used.map((p) => `${p.product_name} ${p.quantity}${p.unit}`).join(", "),
        ])
      );
    } else {
      exportToCsv(
        `atsargu-judejimas_${from}_${to}.csv`,
        ["Data", "Tipas", "Produktas", "Kiekis", "Vnt.", "Partija", "Tiekėjas", "Dok. Nr.", "Gyvūnas"],
        movements.map((m) => [
          formatDate(m.movement_at),
          m.movement_type === "pajamavimas" ? "Pajamavimas" : "Nurašymas",
          m.product_name,
          m.qty,
          m.unit,
          m.lot ?? "",
          m.supplier_name ?? "",
          m.doc_number ?? "",
          m.animal_tag ?? "",
        ])
      );
    }
  }

  function handleExportPdf() {
    if (tab === "visits") {
      exportToPdf(
        `gydymu-zurnalas_${from}_${to}.pdf`,
        `Gydymų žurnalas · ${formatDate(from)} – ${formatDate(to)}`,
        ["Data", "Gyvūnas", "Priežastis/Diagnozė", "Produktai", "Kaina"],
        visits.map((v) => [
          formatDate(v.visit_date),
          v.animal_tag ?? "",
          v.reason || v.diagnosis || "",
          v.products_used.map((p) => `${p.product_name} ${p.quantity}${p.unit}`).join(", "),
          formatMoney(v.service_price),
        ])
      );
    } else {
      exportToPdf(
        `atsargu-judejimas_${from}_${to}.pdf`,
        `Atsargų judėjimo žurnalas · ${formatDate(from)} – ${formatDate(to)}`,
        ["Data", "Tipas", "Produktas", "Kiekis", "Partija", "Tiekėjas / Gyvūnas"],
        movements.map((m) => [
          formatDate(m.movement_at),
          m.movement_type === "pajamavimas" ? "Pajamavimas" : "Nurašymas",
          m.product_name,
          formatQty(m.qty, m.unit),
          m.lot ?? "",
          m.supplier_name ?? m.animal_tag ?? "",
        ])
      );
    }
  }

  return (
    <div>
      <PageHeader title="Ataskaitos" description="Veterinariniai žurnalai su CSV/PDF eksportu" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          <button
            onClick={() => setTab("visits")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "visits" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Gydymų žurnalas
          </button>
          <button
            onClick={() => setTab("movements")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "movements" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Atsargų judėjimo žurnalas
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <span className="text-sm text-slate-400">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>
            <Download size={14} /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportPdf}>
            <FileText size={14} /> PDF
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : tab === "visits" ? (
          visits.length === 0 ? (
            <div className="p-5">
              <EmptyState message="Nėra vizitų pasirinktu laikotarpiu." />
            </div>
          ) : (
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
                    <td className="px-5 py-3 text-slate-600">{formatMoney(v.service_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : movements.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Nėra atsargų judėjimo pasirinktu laikotarpiu." />
          </div>
        ) : (
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
                        m.movement_type === "pajamavimas"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
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
        )}
      </Card>
    </div>
  );
}
