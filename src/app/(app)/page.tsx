"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PawPrint, Stethoscope, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { STOCK_STATUS_COLORS, STOCK_STATUS_LABELS } from "@/lib/labels";

type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];

export default function DashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [animalCount, setAnimalCount] = useState(0);
  const [monthVisitCount, setMonthVisitCount] = useState(0);
  const [monthRevenue, setMonthRevenue] = useState(0);
  const [recentVisits, setRecentVisits] = useState<Visit[]>([]);
  const [attentionBatches, setAttentionBatches] = useState<BatchRow[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartStr = monthStart.toISOString().slice(0, 10);

      const [{ count: animals }, { data: monthVisits }, { data: recent }, { data: batches }] =
        await Promise.all([
          supabase.from("animals").select("*", { count: "exact", head: true }).eq("active", true),
          supabase.from("visits").select("service_price").gte("visit_date", monthStartStr),
          supabase.from("visit_history_view").select("*").limit(5),
          supabase
            .from("stock_by_batch")
            .select("*")
            .in("stock_status", ["low", "expired"])
            .order("expiry_date", { nullsFirst: false })
            .limit(8),
        ]);

      setAnimalCount(animals ?? 0);
      setMonthVisitCount(monthVisits?.length ?? 0);
      setMonthRevenue((monthVisits ?? []).reduce((sum, v) => sum + (v.service_price ?? 0), 0));
      setRecentVisits(recent ?? []);
      setAttentionBatches(batches ?? []);
      setLoading(false);
    }
    load();
  }, [supabase]);

  return (
    <div>
      <PageHeader title="Pagrindinis" description="EQ VET veiklos suvestinė" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Aktyvūs gyvūnai" value={loading ? "…" : animalCount} icon={<PawPrint size={18} />} />
        <StatCard
          label="Vizitai šį mėnesį"
          value={loading ? "…" : monthVisitCount}
          icon={<Stethoscope size={18} />}
        />
        <StatCard
          label="Paslaugų pajamos šį mėnesį"
          value={loading ? "…" : formatMoney(monthRevenue)}
          icon={<Package size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Reikia dėmesio (atsargos)"
          actions={
            <Link href="/inventory" className="text-xs font-medium text-emerald-700 hover:underline">
              Visos atsargos →
            </Link>
          }
        >
          {loading ? (
            <p className="text-sm text-slate-500">Kraunama...</p>
          ) : attentionBatches.length === 0 ? (
            <EmptyState message="Viskas tvarkoje — nėra mažų likučių ar pasibaigusio galiojimo." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attentionBatches.map((b) => (
                <li key={b.batch_id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{b.product_name}</div>
                    <div className="text-xs text-slate-500">
                      {formatQty(b.qty_left, b.unit)} liko
                      {b.expiry_date ? ` · galioja iki ${formatDate(b.expiry_date)}` : ""}
                    </div>
                  </div>
                  <Badge className={STOCK_STATUS_COLORS[b.stock_status]}>
                    {STOCK_STATUS_LABELS[b.stock_status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Paskutiniai vizitai"
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
                <li key={v.visit_id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{v.animal_tag ?? "—"}</span>
                    <span className="text-xs text-slate-500">{formatDate(v.visit_date)}</span>
                  </div>
                  <div className="text-xs text-slate-500">{v.reason || v.diagnosis || "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
