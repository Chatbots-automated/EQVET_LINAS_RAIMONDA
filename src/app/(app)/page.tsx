"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  Euro,
  PackagePlus,
  PawPrint,
  Stethoscope,
  Package,
  ShieldAlert,
  TrendingDown,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { STOCK_STATUS_COLORS, STOCK_STATUS_LABELS } from "@/lib/labels";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function DashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);

  const [animalCount, setAnimalCount] = useState(0);
  const [clientCount, setClientCount] = useState(0);
  const [productCount, setProductCount] = useState(0);
  const [newClientsThisMonth, setNewClientsThisMonth] = useState(0);

  const [visitsToday, setVisitsToday] = useState(0);
  const [visitsWeek, setVisitsWeek] = useState(0);
  const [visitsMonth, setVisitsMonth] = useState(0);
  const [monthRevenue, setMonthRevenue] = useState(0);

  const [stockValue, setStockValue] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);
  const [receivedLast7Days, setReceivedLast7Days] = useState(0);
  const [avgBatchValue, setAvgBatchValue] = useState(0);

  const [recentVisits, setRecentVisits] = useState<Visit[]>([]);
  const [attentionBatches, setAttentionBatches] = useState<BatchRow[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const now = new Date();
      const today = startOfDay(now);
      const weekStart = startOfDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStartStr = monthStart.toISOString().slice(0, 10);

      const [
        { count: animals },
        { count: clients },
        { count: products },
        { count: newClients },
        { data: monthVisits },
        { data: batches },
        { count: recentBatchCount },
        { data: recent },
      ] = await Promise.all([
        supabase.from("animals").select("*", { count: "exact", head: true }).eq("active", true),
        supabase.from("clients").select("*", { count: "exact", head: true }),
        supabase.from("products").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase
          .from("clients")
          .select("*", { count: "exact", head: true })
          .gte("created_at", monthStart.toISOString()),
        supabase.from("visits").select("visit_date, service_price").gte("visit_date", monthStartStr),
        supabase.from("stock_by_batch").select("*"),
        supabase
          .from("batches")
          .select("*", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo.toISOString()),
        supabase.from("visit_history_view").select("*").limit(5),
      ]);

      const visits = monthVisits ?? [];
      setVisitsMonth(visits.length);
      setVisitsWeek(visits.filter((v) => new Date(v.visit_date) >= weekStart).length);
      setVisitsToday(visits.filter((v) => new Date(v.visit_date) >= today).length);
      setMonthRevenue(visits.reduce((sum, v) => sum + (v.service_price ?? 0), 0));

      const batchRows = batches ?? [];
      const value = batchRows.reduce((sum, b) => {
        if (!b.qty_left || !b.purchase_price || !b.received_qty) return sum;
        return sum + b.purchase_price * (b.qty_left / b.received_qty);
      }, 0);
      setStockValue(value);
      setLowStockCount(batchRows.filter((b) => b.stock_status === "low").length);
      setExpiredCount(batchRows.filter((b) => b.stock_status === "expired").length);
      const pricedBatches = batchRows.filter((b) => b.purchase_price != null);
      setAvgBatchValue(
        pricedBatches.length
          ? pricedBatches.reduce((sum, b) => sum + (b.purchase_price ?? 0), 0) / pricedBatches.length
          : 0
      );

      setAnimalCount(animals ?? 0);
      setClientCount(clients ?? 0);
      setProductCount(products ?? 0);
      setNewClientsThisMonth(newClients ?? 0);
      setReceivedLast7Days(recentBatchCount ?? 0);
      setRecentVisits(recent ?? []);

      const attention = batchRows
        .filter((b) => b.stock_status === "low" || b.stock_status === "expired")
        .sort((a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999"))
        .slice(0, 8);
      setAttentionBatches(attention);

      setLoading(false);
    }
    load();
  }, [supabase]);

  return (
    <div>
      <PageHeader title="Pagrindinis" description="EQ VET veiklos suvestinė" />

      {/* Primary stats */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Aktyvūs gyvūnai"
          value={loading ? "…" : animalCount}
          icon={<PawPrint size={18} />}
          tone="brand"
        />
        <StatCard
          label="Vizitai šį mėnesį"
          value={loading ? "…" : visitsMonth}
          icon={<Stethoscope size={18} />}
          tone="emerald"
          hint={loading ? undefined : `${visitsToday} šiandien`}
        />
        <StatCard
          label="Paslaugų pajamos"
          value={loading ? "…" : formatMoney(monthRevenue)}
          icon={<Euro size={18} />}
          tone="amber"
          hint="Šį mėnesį"
        />
        <StatCard
          label="Atsargų vertė"
          value={loading ? "…" : formatMoney(stockValue)}
          icon={<Package size={18} />}
          tone="rose"
          hint={loading ? undefined : `${lowStockCount + expiredCount} reikia dėmesio`}
        />
      </div>

      {/* Secondary mini stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Users className="mb-1.5 size-5 text-slate-400" />
          <p className="text-xl font-bold text-slate-900">{loading ? "…" : clientCount}</p>
          <p className="text-xs text-slate-500">Klientai</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Package className="mb-1.5 size-5 text-slate-400" />
          <p className="text-xl font-bold text-slate-900">{loading ? "…" : productCount}</p>
          <p className="text-xs text-slate-500">Produktai</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <TrendingDown className="mb-1.5 size-5 text-slate-400" />
          <p className="text-xl font-bold text-slate-900">{loading ? "…" : lowStockCount}</p>
          <p className="text-xs text-slate-500">Mažos atsargos</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <AlertTriangle className="mb-1.5 size-5 text-slate-400" />
          <p className="text-xl font-bold text-slate-900">{loading ? "…" : expiredCount}</p>
          <p className="text-xs text-slate-500">Pasibaigęs galiojimas</p>
        </div>
      </div>

      {/* Colorful widget panels */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-600 p-2">
              <Stethoscope className="size-5 text-white" />
            </div>
            <h3 className="font-semibold text-slate-900">Vizitai</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Šiandien</span>
              <span className="text-2xl font-bold text-blue-600">{loading ? "…" : visitsToday}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Šią savaitę</span>
              <span className="text-lg font-semibold text-slate-700">{loading ? "…" : visitsWeek}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Šį mėnesį</span>
              <span className="text-lg font-semibold text-slate-700">{loading ? "…" : visitsMonth}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-600 p-2">
              <PackagePlus className="size-5 text-white" />
            </div>
            <h3 className="font-semibold text-slate-900">Pajamavimas</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Per 7 dienas</span>
              <span className="text-2xl font-bold text-emerald-600">{loading ? "…" : receivedLast7Days}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Vid. partijos vertė</span>
              <span className="text-lg font-semibold text-slate-700">
                {loading ? "…" : formatMoney(avgBatchValue)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-600 p-2">
              <Users className="size-5 text-white" />
            </div>
            <h3 className="font-semibold text-slate-900">Klientai</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Nauji šį mėnesį</span>
              <span className="text-2xl font-bold text-amber-600">{loading ? "…" : newClientsThisMonth}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">Iš viso</span>
              <span className="text-lg font-semibold text-slate-700">{loading ? "…" : clientCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* List widgets */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Atsargų įspėjimai"
          titleIcon={<ShieldAlert size={15} className="text-amber-600" />}
          actions={
            attentionBatches.length > 0 ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {attentionBatches.length}
              </span>
            ) : undefined
          }
        >
          {loading ? (
            <p className="text-sm text-slate-500">Kraunama...</p>
          ) : attentionBatches.length === 0 ? (
            <EmptyState message="Viskas tvarkoje — nėra mažų likučių ar pasibaigusio galiojimo." />
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {attentionBatches.map((b) => (
                <div
                  key={b.batch_id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    b.stock_status === "expired" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                  }`}
                >
                  {b.stock_status === "expired" ? (
                    <Clock className="mt-0.5 size-4 shrink-0 text-red-600" />
                  ) : (
                    <TrendingDown className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{b.product_name}</p>
                    <p className="text-xs text-slate-600">
                      {formatQty(b.qty_left, b.unit)} liko
                      {b.expiry_date ? ` · iki ${formatDate(b.expiry_date)}` : ""}
                    </p>
                  </div>
                  <Badge className={STOCK_STATUS_COLORS[b.stock_status]}>{STOCK_STATUS_LABELS[b.stock_status]}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Paskutiniai vizitai"
          titleIcon={<Stethoscope size={15} className="text-teal-600" />}
          actions={
            <Link href="/visits" className="text-xs font-medium text-emerald-700 hover:underline">
              Visi vizitai →
            </Link>
          }
        >
          {loading ? (
            <p className="text-sm text-slate-500">Kraunama...</p>
          ) : recentVisits.length === 0 ? (
            <EmptyState message="Vizitų dar nėra." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentVisits.map((v) => (
                <li key={v.visit_id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <span className="font-medium text-slate-900">{v.animal_tag ?? "—"}</span>
                    <span className="ml-2 text-xs text-slate-500">{v.reason || v.diagnosis || "—"}</span>
                  </div>
                  <span className="text-xs text-slate-500">{formatDate(v.visit_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
