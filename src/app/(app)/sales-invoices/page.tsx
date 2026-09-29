"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Download, Eye, FileText, Plus, Receipt, RefreshCw, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { InvoiceDraftModal } from "@/components/invoices/InvoiceDraftModal";
import { PaymentModal } from "@/components/invoices/PaymentModal";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { centsToNumber, toCents } from "@/lib/money";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
} from "@/lib/labels";
import { importInvoicesAction, reconcileInvoiceAction } from "./actions";

type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];
type Item = Database["public"]["Tables"]["sales_invoice_items"]["Row"];
type Payment = Database["public"]["Tables"]["sales_invoice_payments"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export default function SalesInvoicesPage() {
  return (
    <Suspense fallback={null}>
      <SalesInvoicesInner />
    </Suspense>
  );
}

function SalesInvoicesInner() {
  const supabase = createClient();
  const clientFilter = useSearchParams().get("client");

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const [draftOpen, setDraftOpen] = useState(false);
  const [payFor, setPayFor] = useState<SalesInvoice | null>(null);
  const [detail, setDetail] = useState<SalesInvoice | null>(null);

  async function load() {
    setLoading(true);
    let q = supabase.from("sales_invoices").select("*").order("date", { ascending: false }).order("series_number", { ascending: false });
    if (clientFilter) q = q.eq("client_id", clientFilter);
    const [{ data: inv }, { data: cl }] = await Promise.all([q, supabase.from("clients").select("*").order("name")]);
    setInvoices(inv ?? []);
    setClients(cl ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  // Mirror Invoice123 automatically every time the page is opened
  // (new / paid / deleted there) — the button is only for a manual refresh.
  useEffect(() => {
    syncFromInvoice123({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncFromInvoice123({ silent = false } = {}) {
    setImporting(true);
    if (!silent) setNotice(null);
    const res = await importInvoicesAction();
    setImporting(false);
    if (!res.ok) {
      if (!silent) setNotice({ tone: "error", text: res.error });
      return;
    }
    const { inserted, updated, removed } = res.data;
    const parts = [
      inserted && `${inserted} naujos`,
      updated && `${updated} atnaujintos (apmokėjimai)`,
      removed.length && `pašalintos, nes ištrintos Sąskaita123: ${removed.join(", ")}`,
    ].filter(Boolean);
    if (parts.length) {
      setNotice({ tone: "ok", text: `Sąskaita123: ${parts.join("; ")}.` });
      load();
    } else if (!silent) {
      setNotice({ tone: "ok", text: "Sąskaitos sutampa su Sąskaita123 — pakeitimų nėra." });
    }
  }

  async function handleReconcile(inv: SalesInvoice) {
    const res = await reconcileInvoiceAction(inv.id);
    if (!res.ok) return setNotice({ tone: "error", text: res.error });
    setNotice({ tone: res.data.status === "created" ? "ok" : "error", text: res.data.status === "created" ? `Sąskaita rasta: ${res.data.series_title} ${res.data.series_number}.` : res.data.sync_error ?? "" });
    load();
  }

  const clientName = clients.find((c) => c.id === clientFilter)?.name;
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      invoices.filter((i) =>
        !q ? true : [i.client_name, `${i.series_title ?? ""} ${i.series_number ?? ""}`, i.client_code].some((v) => v?.toLowerCase().includes(q))
      ),
    [invoices, q]
  );

  return (
    <div>
      <PageHeader
        title={clientName ? `Sąskaitos · ${clientName}` : "Sąskaitos"}
        description="Sąskaitos, išrašytos per Sąskaita123."
        actions={
          <>
            <Button variant="secondary" onClick={() => syncFromInvoice123()} disabled={importing}>
              <RefreshCw size={16} className={importing ? "animate-spin" : ""} />
              {importing ? "Tikrinama Sąskaita123..." : "Atnaujinti iš Sąskaita123"}
            </Button>
            <Button onClick={() => setDraftOpen(true)}>
              <Plus size={16} /> Nauja sąskaita
            </Button>
          </>
        }
      />

      {notice && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {notice.text}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Ieškoti pagal numerį, klientą, kodą..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        {clientFilter && (
          <Link href="/sales-invoices" className="text-sm text-slate-500 hover:text-slate-700">
            Rodyti visas ×
          </Link>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Sąskaitų dar nėra. Išrašykite naują arba atnaujinkite iš Sąskaita123." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Numeris</th>
                  <th className="px-5 py-3">Klientas</th>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3">Terminas</th>
                  <th className="px-5 py-3 text-right">Suma</th>
                  <th className="px-5 py-3 text-right">Apmokėta</th>
                  <th className="px-5 py-3">Būsena</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {i.status === "created" ? `${i.series_title ?? ""} ${i.series_number ?? ""}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{i.client_name}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(i.date)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(i.date_due)}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatMoney(i.total)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatMoney(i.paid_total)}</td>
                    <td className="px-5 py-3">
                      {i.status === "created" ? (
                        <Badge className={PAYMENT_STATUS_COLORS[i.payment_status]}>{PAYMENT_STATUS_LABELS[i.payment_status]}</Badge>
                      ) : (
                        <Badge className={i.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}>
                          {INVOICE_STATUS_LABELS[i.status]}
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Peržiūrėti" onClick={() => setDetail(i)}>
                          <Eye size={16} />
                        </IconButton>
                        {i.status === "created" && (
                          <>
                            <a href={`/api/sales-invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" title="PDF" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                              <FileText size={16} />
                            </a>
                            <a href={`/api/sales-invoices/${i.id}/pdf?download=1`} title="Atsisiųsti PDF" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                              <Download size={16} />
                            </a>
                            {i.payment_status !== "paid" && i.payment_status !== "overpaid" && (
                              <IconButton title="Pažymėti apmokėta" onClick={() => setPayFor(i)}>
                                <Wallet size={16} />
                              </IconButton>
                            )}
                          </>
                        )}
                        {(i.status === "needs_reconcile" || i.status === "creating") && (
                          <Button size="sm" variant="secondary" onClick={() => handleReconcile(i)}>
                            Patikrinti
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvoiceDraftModal
        open={draftOpen}
        onClose={() => {
          setDraftOpen(false);
          load();
        }}
        clients={clients}
        initialClientId={clientFilter}
      />

      <PaymentModal
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onSaved={() => {
          setPayFor(null);
          setNotice({ tone: "ok", text: "Mokėjimas užregistruotas Sąskaita123." });
          load();
        }}
      />

      <InvoiceDetailModal invoice={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
      {children}
    </button>
  );
}

function InvoiceDetailModal({ invoice, onClose }: { invoice: SalesInvoice | null; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    if (!invoice) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("sales_invoice_items").select("*").eq("invoice_id", invoice.id).order("position"),
      supabase.from("sales_invoice_payments").select("*").eq("invoice_id", invoice.id).order("payment_date"),
    ]).then(([{ data: it }, { data: pay }]) => {
      setItems(it ?? []);
      setPayments(pay ?? []);
    });
  }, [invoice]);

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title={invoice ? (invoice.status === "created" ? `Sąskaita ${invoice.series_title ?? ""} ${invoice.series_number ?? ""}` : "Sąskaita (neišrašyta)") : ""}
      icon={<Receipt size={18} />}
      iconClassName="bg-amber-50 text-amber-700"
      wide
    >
      {invoice && (
        <div className="space-y-4 text-sm">
          {invoice.sync_error && invoice.status !== "created" && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{invoice.sync_error}</p>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Klientas">{invoice.client_name}</Field>
            <Field label="Data">{formatDate(invoice.date)}</Field>
            <Field label="Apmokėti iki">{formatDate(invoice.date_due)}</Field>
            <Field label="Būsena">{invoice.status === "created" ? PAYMENT_STATUS_LABELS[invoice.payment_status] : INVOICE_STATUS_LABELS[invoice.status]}</Field>
            <Field label="Suma">{formatMoney(invoice.total)}</Field>
            <Field label="Apmokėta">{formatMoney(invoice.paid_total)}</Field>
            <Field label="Likutis">{formatMoney(centsToNumber(Math.max(0, (toCents(invoice.total) ?? 0) - (toCents(invoice.paid_total) ?? 0))))}</Field>
            <Field label="Šaltinis">{invoice.source === "gvet" ? "EQ VET" : "Importuota iš Sąskaita123"}</Field>
          </dl>

          <table className="w-full">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Paslauga / prekė</th>
                <th className="py-2 text-right">Kiekis</th>
                <th className="py-2 text-right">Kaina</th>
                <th className="py-2 text-right">Suma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2">{it.title}</td>
                  <td className="py-2 text-right">{formatQty(it.quantity, it.unit_name ?? undefined)}</td>
                  <td className="py-2 text-right">{formatMoney(it.unit_price)}</td>
                  <td className="py-2 text-right">{formatMoney(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <div className="mb-1 font-medium text-slate-700">Mokėjimai</div>
            {payments.length === 0 ? (
              <p className="text-slate-500">Mokėjimų nėra.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2">
                    <span>
                      {formatDate(p.payment_date)} · {PAYMENT_TYPE_LABELS[p.payment_type]}
                      {p.status === "failed" && <span className="ml-2 text-xs text-red-600">nepavyko: {p.sync_error}</span>}
                      {p.status === "pending" && <span className="ml-2 text-xs text-amber-600">siunčiama</span>}
                    </span>
                    <span className={p.status === "synced" ? "font-medium" : "text-slate-400 line-through"}>{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}
