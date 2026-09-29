"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { centsToNumber, lineTotalCents, toCents, toMilli } from "@/lib/money";
import { sendPurchaseAction } from "@/app/(app)/sales-invoices/actions";

type Purchase = Database["public"]["Tables"]["invoices"]["Row"];
type Item = Database["public"]["Tables"]["invoice_items"]["Row"];

const STANDARD_RATES = [0, 5, 9, 21];

/** Document-level VAT share, if it is clearly one standard rate — only a suggestion. */
function suggestedRate(p: Purchase): number | null {
  const net = toCents(p.total_net);
  const vat = toCents(p.total_vat);
  if (!net || vat === null) return null;
  const rate = Math.round((vat * 100) / net);
  return STANDARD_RATES.includes(rate) ? rate : null;
}

// Display-only preview; the server recomputes everything.
function lineNetCents(it: Item): number | null {
  const net = toCents(it.total_price);
  if (net !== null) return net;
  const q = toMilli(it.quantity);
  const p = toCents(it.unit_price);
  return q !== null && p !== null ? lineTotalCents(q, p) : null;
}

export function SendPurchaseModal({
  purchase,
  onClose,
  onSent,
}: {
  purchase: Purchase | null;
  onClose: () => void;
  onSent?: (p: Purchase) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<{ enabled: boolean; default_expense_type_id: string | null } | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ linkedExisting: boolean } | null>(null);

  useEffect(() => {
    if (!purchase) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setDone(null);
    setSettings(undefined);
    /* eslint-enable react-hooks/set-state-in-effect */
    const supabase = createClient();
    Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", purchase.id).order("created_at"),
      supabase.from("invoice123_settings").select("enabled, default_expense_type_id").maybeSingle(),
    ]).then(([{ data: it }, { data: st }]) => {
      const list = it ?? [];
      const fallback = suggestedRate(purchase);
      setItems(list);
      setRates(Object.fromEntries(list.map((i) => [i.id, i.vat_rate != null ? String(i.vat_rate) : fallback != null ? String(fallback) : ""])));
      setSettings(st ?? null);
    });
  }, [purchase]);

  const lines = items.map((it) => {
    const net = lineNetCents(it);
    const rate = rates[it.id] === "" ? null : Number(rates[it.id]);
    const gross = net !== null && rate !== null && Number.isInteger(rate) ? Math.floor((net * (100 + rate) + 50) / 100) : null;
    return { it, net, rate, gross };
  });
  const totalGross = lines.reduce((s, l) => s + (l.gross ?? 0), 0);
  const docGross = purchase ? toCents(purchase.total_gross) : null;
  const mismatch = docGross !== null && docGross > 0 && lines.every((l) => l.gross !== null) && Math.abs(totalGross - docGross) > 1;
  const ready = settings?.enabled && settings.default_expense_type_id;

  async function send() {
    if (!purchase || sending) return;
    setSending(true);
    setError(null);
    const res = await sendPurchaseAction({
      purchaseId: purchase.id,
      vatRates: lines.filter((l) => l.rate !== null).map((l) => ({ itemId: l.it.id, vatRate: l.rate! })),
    });
    setSending(false);
    if (!res.ok) return setError(res.error);
    if (res.data.purchase.invoice123_sync_status === "sent") {
      setDone({ linkedExisting: res.data.linkedExisting });
      onSent?.(res.data.purchase);
    } else {
      setError(res.data.purchase.invoice123_sync_error ?? "Nepavyko išsiųsti.");
    }
  }

  return (
    <Modal
      open={!!purchase}
      onClose={onClose}
      title={purchase ? `Pirkimas → Sąskaita123 · ${purchase.supplier_name ?? ""} ${purchase.invoice_number ?? ""}` : ""}
      icon={<Send size={18} />}
      iconClassName="bg-sky-50 text-sky-700"
      wide
    >
      {purchase && settings === undefined ? (
        <p className="text-sm text-slate-500">Kraunama...</p>
      ) : purchase && !ready ? (
        <div className="space-y-2 text-sm">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            {settings?.enabled ? "Nustatymuose nepasirinktas pirkimų išlaidų tipas." : "Sąskaita123 integracija neaktyvi."}
          </p>
          <Link href="/settings/invoice123" className="font-medium text-emerald-700 hover:underline">
            Atidaryti Sąskaita123 nustatymus →
          </Link>
        </div>
      ) : purchase && done ? (
        <div className="space-y-3 text-center">
          <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
          <p className="text-sm text-slate-700">
            {done.linkedExisting
              ? "Šis pirkimas jau buvo Sąskaita123 (tas pats tiekėjas ir dokumento Nr.) — susieta, dublikatas nesukurtas."
              : "Pirkimas užregistruotas Sąskaita123."}
          </p>
          <Button onClick={onClose}>Uždaryti</Button>
        </div>
      ) : purchase ? (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Tiekėjas</dt><dd className="font-medium">{purchase.supplier_name ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Dokumento Nr.</dt><dd className="font-medium">{purchase.invoice_number ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Data</dt><dd className="font-medium">{formatDate(purchase.invoice_date)}</dd></div>
            <div><dt className="text-xs text-slate-500">Dokumento suma</dt><dd className="font-medium">{formatMoney(purchase.total_gross)}</dd></div>
          </dl>

          <table className="w-full">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Prekė</th>
                <th className="py-2 text-right">Kiekis</th>
                <th className="py-2 text-right">Be PVM</th>
                <th className="py-2 text-right">PVM %</th>
                <th className="py-2 text-right">Su PVM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map(({ it, net, gross }) => (
                <tr key={it.id}>
                  <td className="py-2">{it.description ?? "—"}</td>
                  <td className="py-2 text-right">{formatQty(it.quantity)}</td>
                  <td className="py-2 text-right">{net === null ? "—" : formatMoney(centsToNumber(net))}</td>
                  <td className="py-2 text-right">
                    <input
                      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right"
                      inputMode="numeric"
                      value={rates[it.id] ?? ""}
                      onChange={(e) => setRates((r) => ({ ...r, [it.id]: e.target.value.replace(/[^\d]/g, "") }))}
                      disabled={sending}
                    />
                  </td>
                  <td className="py-2 text-right">{gross === null ? "—" : formatMoney(centsToNumber(gross))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-slate-500">Bus užregistruota Sąskaita123</span>
            <span className="text-lg font-bold">{formatMoney(centsToNumber(totalGross))}</span>
          </div>

          {mismatch && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              Eilučių suma su PVM ({formatMoney(centsToNumber(totalGross))}) nesutampa su dokumento suma (
              {formatMoney(purchase.total_gross)}). Patikrinkite PVM tarifus prieš siųsdami.
            </p>
          )}
          {purchase.invoice123_sync_status === "failed" && purchase.invoice123_sync_error && !error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">Ankstesnis bandymas: {purchase.invoice123_sync_error}</p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              Atšaukti
            </Button>
            <Button onClick={send} disabled={sending || lines.some((l) => l.gross === null)}>
              {sending ? "Siunčiama..." : "Siųsti į Sąskaita123"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
