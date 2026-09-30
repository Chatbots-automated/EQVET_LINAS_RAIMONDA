"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, PawPrint, Plus, Receipt, Stethoscope, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DateField } from "@/components/ui/Field";
import { InvoiceDraftModal, type DraftLine } from "@/components/invoices/InvoiceDraftModal";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { centsToNumber, toCents } from "@/lib/money";
import { INVOICE_STATUS_LABELS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS, speciesLabel } from "@/lib/labels";
import { visitInvoiceLines } from "@/lib/visit-pricing";
import { isInvoiced, loadInvoicesByVisit, type VisitInvoice } from "@/lib/visit-invoices";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type Animal = Database["public"]["Tables"]["animals"]["Row"];
type Visit = Database["public"]["Views"]["visit_history_view"]["Row"];
type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];

const FILTER_INPUT = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
const TH = "px-5 py-3";

// Everything about one client in one place: animals, visits (with prices)
// and invoices — filterable by period, animal and service / product.
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();

  const [client, setClient] = useState<ClientRow | null>(null);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [itemTitles, setItemTitles] = useState<Map<string, string[]>>(new Map());
  const [invoicesByVisit, setInvoicesByVisit] = useState<Map<string, VisitInvoice[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [animalFilter, setAnimalFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");

  // null = closed; { visit: null } = blank invoice for this client.
  const [draft, setDraft] = useState<{ visit: Visit | null } | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: a }, { data: v }, { data: inv }] = await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase.from("animals").select("*").eq("client_id", id).order("tag_no"),
      supabase.from("visit_history_view").select("*").eq("client_id", id),
      supabase.from("sales_invoices").select("*").eq("client_id", id).order("date", { ascending: false }).order("series_number", { ascending: false }),
    ]);
    const invoiceIds = (inv ?? []).map((i) => i.id);
    const { data: items } = invoiceIds.length
      ? await supabase.from("sales_invoice_items").select("invoice_id, title, position").in("invoice_id", invoiceIds).order("position")
      : { data: [] };
    const titles = new Map<string, string[]>();
    for (const it of items ?? []) titles.set(it.invoice_id, [...(titles.get(it.invoice_id) ?? []), it.title]);

    setInvoicesByVisit(await loadInvoicesByVisit(supabase, (v ?? []).map((x) => x.visit_id)));
    setClient(c ?? null);
    setAnimals(a ?? []);
    setVisits(v ?? []);
    setInvoices(inv ?? []);
    setItemTitles(titles);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const q = itemFilter.trim().toLowerCase();

  const filteredVisits = useMemo(
    () =>
      visits.filter((v) => {
        if (dateFrom && v.visit_date < dateFrom) return false;
        if (dateTo && v.visit_date > dateTo) return false;
        if (animalFilter && v.animal_id !== animalFilter) return false;
        if (!q) return true;
        return [v.services, v.reason, v.diagnosis, ...v.products_used.map((p) => p.product_name)].some((x) => x?.toLowerCase().includes(q));
      }),
    [visits, dateFrom, dateTo, animalFilter, q]
  );

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        if (dateFrom && i.date < dateFrom) return false;
        if (dateTo && i.date > dateTo) return false;
        if (animalFilter && i.animal_id !== animalFilter) return false;
        if (!q) return true;
        return (itemTitles.get(i.id) ?? []).some((t) => t.toLowerCase().includes(q));
      }),
    [invoices, itemTitles, dateFrom, dateTo, animalFilter, q]
  );

  // Suggestions for the service / product filter: everything this client was ever treated with or billed for.
  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) {
      for (const s of v.service_lines) set.add(s.title);
      for (const p of v.products_used) set.add(p.product_name);
    }
    for (const titles of itemTitles.values()) for (const t of titles) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, "lt"));
  }, [visits, itemTitles]);

  const issued = filteredInvoices.filter((i) => i.status === "created");
  const invoicedCents = issued.reduce((s, i) => s + (toCents(i.total) ?? 0), 0);
  const paidCents = issued.reduce((s, i) => s + (toCents(i.paid_total) ?? 0), 0);
  const visitsCents = filteredVisits.reduce((s, v) => s + (toCents(v.total_price) ?? 0), 0);
  const uninvoicedCents = filteredVisits
    .filter((v) => !isInvoiced(invoicesByVisit.get(v.visit_id)))
    .reduce((s, v) => s + (toCents(v.total_price) ?? 0), 0);

  const draftLines = useMemo<DraftLine[]>(() => (draft?.visit ? visitInvoiceLines(draft.visit) : []), [draft]);
  const anyFilter = !!(dateFrom || dateTo || animalFilter || itemFilter);

  if (loading && !client) return <div className="text-sm text-slate-500">Kraunama...</div>;
  if (!client) {
    return (
      <div>
        <PageHeader title="Klientas nerastas" />
        <Link href="/clients" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Visi klientai
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/clients" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Visi klientai
      </Link>

      <PageHeader
        title={client.name}
        description={
          [client.company_code && `Kodas ${client.company_code}`, client.vat_code && `PVM ${client.vat_code}`, client.address, client.phone, client.email]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <Button onClick={() => setDraft({ visit: null })} title="Į sąskaitą automatiškai įkeliami visi neišrašyti šio kliento vizitai">
            <Plus size={16} /> Nauja sąskaita
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-36">
          <DateField value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Nuo" />
        </div>
        <span className="text-sm text-slate-400">–</span>
        <div className="w-36">
          <DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} className={`w-full ${FILTER_INPUT}`} aria-label="Iki" />
        </div>
        <select value={animalFilter} onChange={(e) => setAnimalFilter(e.target.value)} className={FILTER_INPUT} aria-label="Gyvūnas">
          <option value="">Visi gyvūnai</option>
          {animals.map((a) => (
            <option key={a.id} value={a.id}>
              {a.tag_no}
              {a.name ? ` · ${a.name}` : ""}
            </option>
          ))}
        </select>
        <input
          list="client-item-titles"
          placeholder="Paslauga / vaistas"
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
          className={`w-52 ${FILTER_INPUT}`}
          aria-label="Paslauga / vaistas"
        />
        <datalist id="client-item-titles">
          {suggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {anyFilter && (
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setAnimalFilter("");
              setItemFilter("");
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Išvalyti ×
          </button>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vizitai"
          value={filteredVisits.length}
          hint={`Suma ${formatMoney(centsToNumber(visitsCents))}`}
          icon={<Stethoscope size={18} />}
          tone="brand"
        />
        <StatCard
          label="Dar neišrašyta"
          value={formatMoney(centsToNumber(uninvoicedCents))}
          hint="Vizitai be sąskaitos"
          icon={<Receipt size={18} />}
          tone="amber"
        />
        <StatCard
          label="Išrašyta sąskaitų"
          value={formatMoney(centsToNumber(invoicedCents))}
          hint={`${issued.length} sąsk.`}
          icon={<FileText size={18} />}
          tone="emerald"
        />
        <StatCard
          label="Neapmokėta"
          value={formatMoney(centsToNumber(Math.max(0, invoicedCents - paidCents)))}
          hint={`Apmokėta ${formatMoney(centsToNumber(paidCents))}`}
          icon={<Wallet size={18} />}
          tone="rose"
        />
      </div>

      <Card title="Gyvūnai" titleIcon={<PawPrint size={16} />} className="mb-6">
        {animals.length === 0 ? (
          <p className="text-sm text-slate-500">Šiam klientui gyvūnų nepriskirta.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {animals.map((a) => (
              <Link
                key={a.id}
                href={`/visits?animal=${a.id}`}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                title="Gyvūno vizitai"
              >
                <span className="font-medium text-slate-900">{a.tag_no}</span>
                <span className="ml-1.5 text-slate-500">{[a.name, speciesLabel(a.species)].filter(Boolean).join(" · ")}</span>
                {!a.active && <Badge className="ml-2">Neaktyvus</Badge>}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="Vizitai" titleIcon={<Stethoscope size={16} />} className="mb-6 overflow-hidden [&>div:last-child]:p-0">
        {filteredVisits.length === 0 ? (
          <div className="p-5">
            <EmptyState message={anyFilter ? "Pagal pasirinktus filtrus vizitų nerasta." : "Vizitų dar nėra."} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH}>Data</th>
                  <th className={TH}>Gyvūnas</th>
                  <th className={TH}>Paslaugos</th>
                  <th className={TH}>Vaistai ir priemonės</th>
                  <th className={`${TH} text-right`}>Suma</th>
                  <th className={TH}>Sąskaita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVisits.map((v) => {
                  const visitInvoices = (invoicesByVisit.get(v.visit_id) ?? []).filter((i) => i.status === "created");
                  const pending = isInvoiced(invoicesByVisit.get(v.visit_id));
                  return (
                    <tr key={v.visit_id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Link href={`/visits?visit=${v.visit_id}`} className="font-medium text-emerald-700 hover:underline">
                          {formatDate(v.visit_date)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-900">{v.animal_tag ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{v.services || v.reason || "—"}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {v.products_used.map((p) => `${p.product_name} (${formatQty(p.quantity, p.unit)})`).join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-900">{v.total_price > 0 ? formatMoney(v.total_price) : "—"}</td>
                      <td className="px-5 py-3">
                        {visitInvoices.length > 0 ? (
                          visitInvoices.map((i) => (
                            <a key={i.id} href={`/api/sales-invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="mr-1">
                              <Badge className={PAYMENT_STATUS_COLORS[i.payment_status]}>
                                {i.series_title} {i.series_number}
                              </Badge>
                            </a>
                          ))
                        ) : pending ? (
                          <Link href={`/sales-invoices?client=${client.id}`}>
                            <Badge className="bg-amber-50 text-amber-700">Sąskaita tikrinama</Badge>
                          </Link>
                        ) : v.completed_at ? (
                          <Button size="sm" variant="secondary" onClick={() => setDraft({ visit: v })}>
                            <Receipt size={14} /> Išrašyti
                          </Button>
                        ) : (
                          <Link href={`/visits?visit=${v.visit_id}`}>
                            <Badge className="bg-amber-50 text-amber-700">Neužbaigtas — įvesti kainas</Badge>
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Sąskaitos" titleIcon={<Receipt size={16} />} className="overflow-hidden [&>div:last-child]:p-0">
        {filteredInvoices.length === 0 ? (
          <div className="p-5">
            <EmptyState message={anyFilter ? "Pagal pasirinktus filtrus sąskaitų nerasta." : "Sąskaitų dar nėra."} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH}>Numeris</th>
                  <th className={TH}>Data</th>
                  <th className={TH}>Terminas</th>
                  <th className={TH}>Paslaugos / prekės</th>
                  <th className={`${TH} text-right`}>Suma</th>
                  <th className={`${TH} text-right`}>Apmokėta</th>
                  <th className={TH}>Būsena</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium whitespace-nowrap text-slate-900">
                      {i.status === "created" ? (
                        <a href={`/api/sales-invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                          {i.series_title} {i.series_number}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{formatDate(i.date)}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{formatDate(i.date_due)}</td>
                    <td className="px-5 py-3 text-slate-600">{(itemTitles.get(i.id) ?? []).join(", ") || "—"}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3 text-sm">
          <Link href={`/sales-invoices?client=${client.id}`} className="font-medium text-emerald-700 hover:underline">
            Mokėjimai ir visi veiksmai — Sąskaitos →
          </Link>
        </div>
      </Card>

      <InvoiceDraftModal
        open={!!draft}
        onClose={() => {
          setDraft(null);
          load();
        }}
        clients={[client]}
        initialClientId={client.id}
        lockClient
        visitId={draft?.visit?.visit_id ?? null}
        initialLines={draftLines}
      />
    </div>
  );
}
