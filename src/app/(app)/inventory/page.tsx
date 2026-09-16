"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CATEGORY_LABELS, STOCK_STATUS_COLORS, STOCK_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatMoney, formatQty } from "@/lib/format";

type ByProduct = Database["public"]["Views"]["stock_by_product"]["Row"];
type ByBatch = Database["public"]["Views"]["stock_by_batch"]["Row"];

export default function InventoryPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"product" | "batch">("product");
  const [byProduct, setByProduct] = useState<ByProduct[]>([]);
  const [byBatch, setByBatch] = useState<ByBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [{ data: p }, { data: b }] = await Promise.all([
      supabase.from("stock_by_product").select("*").order("product_name"),
      supabase.from("stock_by_batch").select("*").order("expiry_date", { nullsFirst: false }),
    ]);
    setByProduct(p ?? []);
    setByBatch(b ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredProducts = byProduct.filter((p) =>
    p.product_name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredBatches = byBatch.filter((b) =>
    b.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const lowOrExpiredCount = byProduct.filter(
    (p) => p.low_stock_batches > 0 || p.expired_batches > 0
  ).length;

  return (
    <div>
      <PageHeader title="Atsargos" description="Produktų likučiai partijomis (FIFO)" />

      {lowOrExpiredCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} />
          {lowOrExpiredCount} produktui(-ams) reikia dėmesio — mažas likutis arba pasibaigęs galiojimas.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          <button
            onClick={() => setTab("product")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "product" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Pagal produktą
          </button>
          <button
            onClick={() => setTab("batch")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "batch" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Pagal partiją
          </button>
        </div>
        <input
          placeholder="Ieškoti pagal produktą..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : tab === "product" ? (
          filteredProducts.length === 0 ? (
            <div className="p-5">
              <EmptyState message="Atsargų nerasta." />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Produktas</th>
                  <th className="px-5 py-3">Kategorija</th>
                  <th className="px-5 py-3">Likutis</th>
                  <th className="px-5 py-3">Artimiausias galiojimas</th>
                  <th className="px-5 py-3">Būsena</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => (
                  <tr key={p.product_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{p.product_name}</td>
                    <td className="px-5 py-3 text-slate-600">{CATEGORY_LABELS[p.product_category]}</td>
                    <td className="px-5 py-3 text-slate-600">{formatQty(p.on_hand, p.unit)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(p.nearest_expiry)}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {p.expired_batches > 0 && (
                          <Badge className={STOCK_STATUS_COLORS.expired}>
                            {p.expired_batches} pasibaigę
                          </Badge>
                        )}
                        {p.low_stock_batches > 0 && (
                          <Badge className={STOCK_STATUS_COLORS.low}>{p.low_stock_batches} mažai</Badge>
                        )}
                        {p.expired_batches === 0 && p.low_stock_batches === 0 && (
                          <Badge className={STOCK_STATUS_COLORS.available}>OK</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredBatches.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Partijų nerasta." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Produktas</th>
                <th className="px-5 py-3">Partija</th>
                <th className="px-5 py-3">Likutis / Gauta</th>
                <th className="px-5 py-3">Galiojimas</th>
                <th className="px-5 py-3">Tiekėjas</th>
                <th className="px-5 py-3">Kaina</th>
                <th className="px-5 py-3">Būsena</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBatches.map((b) => (
                <tr key={b.batch_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{b.product_name}</td>
                  <td className="px-5 py-3 text-slate-600">{b.lot ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {formatQty(b.qty_left, b.unit)} / {formatQty(b.received_qty, b.unit)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(b.expiry_date)}</td>
                  <td className="px-5 py-3 text-slate-600">{b.supplier_name ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{formatMoney(b.purchase_price)}</td>
                  <td className="px-5 py-3">
                    <Badge className={STOCK_STATUS_COLORS[b.stock_status]}>
                      {STOCK_STATUS_LABELS[b.stock_status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
