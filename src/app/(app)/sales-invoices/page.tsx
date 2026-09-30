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
import { DateField } from "@/components/ui/Field";
import { formatDate, formatMoney, formatQty, todayISO } from "@/lib/format";
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

type StatusFilter = "" | "unpaid" | "partial" | "paid" | "overpaid" | "overdue" | "not_issued";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "Visos būsenos" },
  { value: "unpaid", label: PAYMENT_STATUS_LABELS.unpaid },
  { value: "partial", label: PAYMENT_STATUS_LABELS.partial },
  { value: "paid", label: PAYMENT_STATUS_LABELS.paid },
  { value: "overpaid", label: PAYMENT_STATUS_LABELS.overpaid },
  { value: "overdue", label: "Vėluojančios" },
  { value: "not_issued", label: "Neišrašytos / tikrintinos" },
];

const FILTER_INPUT = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

export default function SalesInvoicesPage() {
  return (
    <Suspense fallback={null}>
      <SalesInvoicesInner />
    </Suspense>
  );
}

function SalesInvoicesInner() {
  const supabase = createClient();
  const [clientFilter, setClientFilter] = useState(useSearchParams().get("client") ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [itemFilter, setItemFilter] = useState("");
  // invoice id → titles of its lines (services / products), for filtering by what was sold.
  const [itemTitles, setItemTitles] = useState<Map<string, string[]>>(new Map());

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
    const [{ data: inv }, { data: cl }, { data: items }] = await Promise.all([
      supabase.from("sales_invoices").select("*").order("date", { ascending: false }).order("series_number", { ascending: false }),
      supabase.from("clients").select("*").order("name"),
      supabase.from("sales_invoice_items").select("invoice_id, title").order("created_at", { ascending: false }).limit(10000),
    ]);
    setInvoices(inv ?? []);
    setClients(cl ?? []);
    const titles = new Map<string, string[]>();
    for (const it of items ?? []) titles.set(it.invoice_id, [...(titles.get(it.invoice_id) ?? []), it.title]);
    setItemTitles(titles);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const itemQ = itemFilter.trim().toLowerCase();
  const filtered = useMemo(() => {
    const today = todayISO();
    return invoices.filter((i) => {
      if (clientFilter && i.client_id !== clientFilter) return false;
      if (dateFrom && i.date < dateFrom) return false;
      if (dateTo && i.date > dateTo) return false;
      if (statusFilter === "not_issued" && i.status === "created") return false;
      if (statusFilter && statusFilter !== "not_issued") {
        if (i.status !== "created") return false;
        if (statusFilter === "overdue") {
          if (!i.date_due || i.date_due >= today || i.payment_status === "paid" || i.payment_status === "overpaid") return false;
        } else if (i.payment_status !== statusFilter) return false;
      }
      if (itemQ && !(itemTitles.get(i.id) ?? []).some((t) => t.toLowerCase().includes(itemQ))) return false;
      if (!q) return true;
      return [i.client_name, `${i.series_title ?? ""} ${i.series_number ?? ""}`, i.client_code].some((v) => v?.toLowerCase().includes(q));
    });
  }, [invoices, q, itemQ, itemTitles, clientFilter, dateFrom, dateTo, statusFilter]);

  const allTitles = useMemo(
    () => [...new Set([...itemTitles.values()].flat())].sort((a, b) => a.localeCompare(b, "lt")),
    [itemTitles]
  );
  const issued = filtered.filter((i) => i.status === "created");
  const sumCents = issued.reduce((s, i) => s + (toCents(i.total) ?? 0), 0);
  const paidCents = issued.reduce((s, i) => s + (toCents(i.paid_total) ?? 0), 0);
  const anyFilter = !!(search || itemFilter || clientFilter || dateFrom || dateTo || statusFilter);

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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Ieškoti pagal numerį, klientą, kodą..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full max-w-xs ${FILTER_INPUT}`}
        />
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={`max-w-56 ${FILTER_INPUT}`} aria-label="Klientas">
          <option value="">Visi klientai</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          list="invoice-item-titles"
          placeholder="Paslauga / prekė"
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
          className={`w-48 ${FILTER_INPUT}`}
          aria-label="Paslauga / prekė"
        />
        <datalist id="invoice-item-titles">
          {allTitles.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={FILTER_INPUT} aria-label="Būsena">
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="w-36">
          <DateField value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Nuo" />
        </div>
        <span className="text-sm text-slate-400">–</span>
        <div className="w-36">
          <DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Iki" />
        </div>
        {anyFilter && (
          <button
            onClick={() => {
              setSearch("");
              setItemFilter("");
              setClientFilter("");
              setDateFrom("");
              setDateTo("");
              setStatusFilter("");
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Išvalyti ×
          </button>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="mb-3 text-sm text-slate-600">
          {filtered.length} sąsk. · suma <span className="font-semibold text-slate-900">{formatMoney(centsToNumber(sumCents))}</span> · apmokėta{" "}
          <span className="font-semibold text-slate-900">{formatMoney(centsToNumber(paidCents))}</span> · likutis{" "}
          <span className="font-semibold text-slate-900">{formatMoney(centsToNumber(Math.max(0, sumCents - paidCents)))}</span>
          {clientFilter && (
            <Link href={`/clients/${clientFilter}`} className="ml-3 font-medium text-emerald-700 hover:underline">
              Kliento kortelė →
            </Link>
          )}
        </p>
      )}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState message={anyFilter ? "Pagal pasirinktus filtrus sąskaitų nerasta." : "Sąskaitų dar nėra. Išrašykite naują arba atnaujinkite iš Sąskaita123."} />
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
        initialClientId={clientFilter || null}
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

          {(invoice.client_id || invoice.visit_id) && (
            <div className="flex flex-wrap gap-4 text-sm">
              {invoice.visit_id && (
                <Link href={`/visits?visit=${invoice.visit_id}`} className="font-medium text-emerald-700 hover:underline">
                  Atidaryti vizitą →
                </Link>
              )}
              {invoice.client_id && (
                <Link href={`/clients/${invoice.client_id}`} className="font-medium text-emerald-700 hover:underline">
                  Kliento kortelė →
                </Link>
              )}
            </div>
          )}

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
