"use client";

import { useEffect, useState } from "react";
import { FileInput, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, PurchaseSyncStatus } from "@/lib/database.types";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney } from "@/lib/format";
import { reconcilePurchaseAction, refreshPurchasesAction } from "@/app/(app)/sales-invoices/actions";
import { SendPurchaseModal } from "./SendPurchaseModal";
import { EditPurchaseModal } from "./EditPurchaseModal";

type Purchase = Database["public"]["Tables"]["invoices"]["Row"];

const STATUS: Record<PurchaseSyncStatus, { label: string; className: string }> = {
  not_sent: { label: "Neišsiųsta", className: "bg-slate-100 text-slate-600" },
  sending: { label: "Siunčiama", className: "bg-amber-50 text-amber-700" },
  sent: { label: "Sąskaita123 ✓", className: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Nepavyko", className: "bg-red-50 text-red-700" },
  needs_reconcile: { label: "Reikia patikrinti", className: "bg-amber-50 text-amber-700" },
};

/** Supplier purchase documents and their Invoice123 (expense) status. */
export function PurchaseDocumentsCard({
  reloadKey,
  openPurchaseId,
  onChanged,
  editable,
}: {
  reloadKey?: number;
  openPurchaseId?: string | null;
  /** Called after a document was edited or removed (stock changed). */
  onChanged?: () => void;
  /** Show edit / remove actions (the Redagavimas tab). */
  editable?: boolean;
}) {
  const [rows, setRows] = useState<Purchase[]>([]);
  const [sendFor, setSendFor] = useState<Purchase | null>(null);
  const [editFor, setEditFor] = useState<Purchase | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const { data } = await createClient()
      .from("invoices")
      .select("*")
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50);
    setRows(data ?? []);
    return data ?? [];
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then((list) => {
      if (openPurchaseId) setSendFor(list.find((p) => p.id === openPurchaseId) ?? null);
    });
  }, [reloadKey, openPurchaseId]);

  // Mirror Invoice123 on open: expenses deleted there → purchase back to "Neišsiųsta".
  useEffect(() => {
    refreshPurchasesAction().then((res) => {
      if (!res.ok) return;
      if (res.data.reset.length) setNotice(`Ištrinta Sąskaita123, galima siųsti iš naujo: ${res.data.reset.join(", ")}.`);
      if (res.data.reset.length || res.data.resolved) load();
    });
  }, []);

  // Removes the document and, atomically, the stock it received. The database refuses if any of it was already used.
  async function remove(p: Purchase) {
    const label = `${p.supplier_name ?? ""} ${p.invoice_number ?? ""}`.trim();
    const stock = p.saved_to_gvet === false ? "" : " Jos prekės bus pašalintos ir iš atsargų bei žurnalų.";
    const sent = p.invoice123_sync_status === "sent" ? " Sąskaita123 pirkimo įrašas liks — jį ištrinkite ten atskirai." : "";
    if (!confirm(`Pašalinti dokumentą ${label}?${stock}${sent}`)) return;
    const { error } = await createClient().rpc("delete_purchase_document", { p_invoice_id: p.id });
    setNotice(error ? `Nepavyko pašalinti: ${error.message}` : `Dokumentas ${label} pašalintas.`);
    load();
    if (!error) onChanged?.();
  }

  async function reconcile(p: Purchase) {
    const res = await reconcilePurchaseAction(p.id);
    setNotice(res.ok ? (res.data.purchase.invoice123_sync_status === "sent" ? "Pirkimas rastas Sąskaita123." : res.data.purchase.invoice123_sync_error) : res.error);
    load();
  }

  return (
    <Card title="Pirkimo dokumentai → Sąskaita123" titleIcon={<FileInput size={16} className="text-sky-600" />} className="mt-6">
      {notice && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>}
      {editable && rows.length > 0 && (
        <p className="mb-3 text-sm text-slate-600">
          Pasirinkite sąskaitą ir spauskite „Redaguoti“, kad pataisytumėte prekes, kiekius, mato vienetus ar sumas, arba „Pašalinti“, kad ją ištrintumėte.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Pirkimo dokumentų dar nėra.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">Tiekėjas</th>
                <th className="px-5 py-2">Dokumento Nr.</th>
                <th className="px-5 py-2">Data</th>
                <th className="px-5 py-2 text-right">Suma</th>
                <th className="px-5 py-2">Sąskaita123</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-2">{p.supplier_name ?? "—"}</td>
                  <td className="px-5 py-2">
                    {p.invoice_number ?? "—"}
                    {p.saved_to_gvet === false && (
                      <Badge className="ml-2 bg-sky-50 text-sky-700">Tik Sąskaita123 — nepajamuota</Badge>
                    )}
                  </td>
                  <td className="px-5 py-2">{formatDate(p.invoice_date)}</td>
                  <td className="px-5 py-2 text-right">{formatMoney(p.total_gross)}</td>
                  <td className="px-5 py-2">
                    <Badge className={(STATUS[p.invoice123_sync_status] ?? STATUS.not_sent).className}>
                      {(STATUS[p.invoice123_sync_status] ?? STATUS.not_sent).label}
                    </Badge>
                  </td>
                  <td className="px-5 py-2 text-right">
                    {(p.invoice123_sync_status === "not_sent" || p.invoice123_sync_status === "failed") && (
                      <Button size="sm" variant="secondary" onClick={() => setSendFor(p)}>
                        {p.invoice123_sync_status === "failed" ? "Bandyti dar kartą" : "Siųsti"}
                      </Button>
                    )}
                    {(p.invoice123_sync_status === "needs_reconcile" || p.invoice123_sync_status === "sending") && (
                      <Button size="sm" variant="secondary" onClick={() => reconcile(p)}>
                        Patikrinti
                      </Button>
                    )}
                    {editable && p.invoice123_sync_status !== "sending" && (
                      <>
                        <Button size="sm" variant="ghost" className="ml-1" onClick={() => setEditFor(p)}>
                          <Pencil size={13} /> Redaguoti
                        </Button>
                        <Button size="sm" variant="ghost" className="ml-1 text-red-600 hover:bg-red-50" onClick={() => remove(p)}>
                          <Trash2 size={13} /> Pašalinti
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditPurchaseModal
        purchase={editFor}
        onClose={() => setEditFor(null)}
        onSaved={() => {
          load();
          onChanged?.();
        }}
      />

      <SendPurchaseModal
        purchase={sendFor}
        onClose={() => {
          setSendFor(null);
          load();
        }}
      />
    </Card>
  );
}
