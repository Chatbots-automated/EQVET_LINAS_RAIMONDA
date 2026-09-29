"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Link2, Plus, Receipt, Trash2, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { formatMoney } from "@/lib/format";
import { centsToNumber, lineTotalCents, toCents, toMilli } from "@/lib/money";
import type { ClientLinkState } from "@/lib/invoice123/clients";
import {
  createInvoice123ClientAction,
  createInvoiceAction,
  getClientLinkStateAction,
  linkClientAction,
  reconcileInvoiceAction,
} from "@/app/(app)/sales-invoices/actions";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];
type Settings = Pick<
  Database["public"]["Tables"]["invoice123_settings"]["Row"],
  "enabled" | "default_payment_term_days" | "company_vat_enabled" | "default_series_title" | "default_unit_name"
>;

export interface DraftLine {
  title: string;
  quantity: string;
  unitPrice: string;
  productId?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const emptyLine = (): DraftLine => ({ title: "", quantity: "1", unitPrice: "" });

// Display-only preview. The server recomputes every amount independently.
function previewCents(l: DraftLine): number | null {
  const q = toMilli(l.quantity);
  const p = toCents(l.unitPrice);
  return q === null || p === null ? null : lineTotalCents(q, p);
}

export function InvoiceDraftModal({
  open,
  onClose,
  onCreated,
  clients,
  initialClientId,
  lockClient,
  visitId,
  initialLines,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (invoice: SalesInvoice) => void;
  clients: ClientRow[];
  initialClientId?: string | null;
  lockClient?: boolean;
  visitId?: string | null;
  initialLines?: DraftLine[];
}) {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [link, setLink] = useState<ClientLinkState | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [dateDue, setDateDue] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SalesInvoice | null>(null);

  // Fresh draft (and fresh idempotency key) every time the modal opens.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setIdempotencyKey(crypto.randomUUID());
    setClientId(initialClientId ?? "");
    setLines(initialLines?.length ? initialLines : [emptyLine()]);
    setDate(today());
    setError(null);
    setResult(null);
    setSettings(undefined);
    /* eslint-enable react-hooks/set-state-in-effect */
    createClient()
      .from("invoice123_settings")
      .select("enabled, default_payment_term_days, company_vat_enabled, default_series_title, default_unit_name")
      .maybeSingle()
      .then(({ data }) => {
        setSettings(data ?? null);
        setDateDue(addDays(today(), data?.default_payment_term_days ?? 30));
      });
  }, [open, initialClientId, initialLines]);

  useEffect(() => {
    if (!open || !clientId) {
      setLink(null); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    setLink(null);
    setLinkBusy(true);
    getClientLinkStateAction(clientId).then((res) => {
      setLinkBusy(false);
      if (res.ok) setLink(res.data);
      else setError(res.error);
    });
  }, [open, clientId]);

  async function doLink(invoice123ClientId: string | null) {
    setLinkBusy(true);
    setError(null);
    const res = invoice123ClientId
      ? await linkClientAction(clientId, invoice123ClientId)
      : await createInvoice123ClientAction(clientId);
    setLinkBusy(false);
    if (res.ok) setLink(res.data);
    else setError(res.error);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await createInvoiceAction({
      idempotencyKey,
      clientId,
      visitId: visitId ?? null,
      date,
      dateDue: dateDue || null,
      lines: lines.map((l) => ({ title: l.title, quantity: l.quantity, unitPrice: l.unitPrice, productId: l.productId ?? null })),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    if (res.data.status === "created") onCreated?.(res.data);
  }

  async function reconcile() {
    if (!result) return;
    setSubmitting(true);
    const res = await reconcileInvoiceAction(result.id);
    setSubmitting(false);
    if (!res.ok) return setError(res.error);
    setResult(res.data);
    if (res.data.status === "created") onCreated?.(res.data);
  }

  const totalCents = lines.reduce((s, l) => s + (previewCents(l) ?? 0), 0);
  const client = clients.find((c) => c.id === clientId);
  const ready = settings?.enabled && !settings.company_vat_enabled;

  return (
    <Modal open={open} onClose={onClose} title="Sąskaitos išrašymas" icon={<Receipt size={18} />} iconClassName="bg-amber-50 text-amber-700" wide>
      {settings === undefined ? (
        <p className="text-sm text-slate-500">Kraunama...</p>
      ) : !ready ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            {settings?.company_vat_enabled
              ? "Jūsų Sąskaita123 paskyra yra PVM mokėtojo — PVM sąskaitų išrašymas iš EQ VET dar neįjungtas."
              : "Sąskaita123 integracija neaktyvi."}
          </p>
          <Link href="/settings/invoice123" className="font-medium text-emerald-700 hover:underline">
            Atidaryti Sąskaita123 nustatymus →
          </Link>
        </div>
      ) : result && result.status === "created" ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
          <div>
            <p className="text-sm text-slate-500">Sąskaita sukurta</p>
            <p className="text-2xl font-bold text-slate-900">
              {result.series_title} {result.series_number}
            </p>
            <p className="text-sm text-slate-600">{formatMoney(result.total)}</p>
          </div>
          <div className="flex justify-center gap-2">
            <a href={`/api/sales-invoices/${result.id}/pdf`} target="_blank" rel="noreferrer">
              <Button variant="secondary" type="button">
                <FileText size={16} /> Peržiūrėti PDF
              </Button>
            </a>
            <Button type="button" onClick={onClose}>
              Uždaryti
            </Button>
          </div>
        </div>
      ) : result && result.status === "needs_reconcile" ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">{result.sync_error}</p>
          <p className="text-slate-600">
            Nekurkite sąskaitos iš naujo, kol nepatikrinta — ji galėjo būti sukurta Sąskaita123.
          </p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Uždaryti
            </Button>
            <Button type="button" onClick={reconcile} disabled={submitting}>
              {submitting ? "Tikrinama..." : "Patikrinti Sąskaita123"}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Klientas"
              required
              wrapperClassName="sm:col-span-3"
              value={clientId}
              disabled={lockClient || submitting}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— pasirinkite —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company_code ? ` (${c.company_code})` : ""}
                </option>
              ))}
            </Select>
            <Input label="Data" type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={submitting} />
            <Input label="Apmokėti iki" type="date" value={dateDue} min={date} onChange={(e) => setDateDue(e.target.value)} disabled={submitting} />
            <div className="text-sm">
              <div className="font-medium text-slate-700">Serija</div>
              <div className="mt-2 text-slate-600">{settings?.default_series_title ?? "—"}</div>
            </div>
          </div>

          {clientId && (
            <ClientLinkPanel link={link} busy={linkBusy} clientName={client?.name ?? ""} onLink={doLink} />
          )}

          <div>
            <div className="mb-2 grid grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <div className="col-span-6">Paslauga / prekė</div>
              <div className="col-span-2">Kiekis</div>
              <div className="col-span-2">Kaina, €</div>
              <div className="col-span-2 text-right">Suma</div>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const cents = previewCents(l);
                const set = (patch: Partial<DraftLine>) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <input
                      className="col-span-6 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      placeholder="Pavadinimas"
                      value={l.title}
                      required
                      disabled={submitting}
                      onChange={(e) => set({ title: e.target.value })}
                    />
                    <input
                      className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      inputMode="decimal"
                      value={l.quantity}
                      required
                      disabled={submitting}
                      onChange={(e) => set({ quantity: e.target.value })}
                    />
                    <input
                      className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.unitPrice}
                      required
                      disabled={submitting}
                      onChange={(e) => set({ unitPrice: e.target.value })}
                    />
                    <div className="col-span-2 flex items-center justify-end gap-1 text-sm text-slate-700">
                      {cents === null ? "—" : formatMoney(centsToNumber(cents))}
                      <button
                        type="button"
                        onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Pašalinti eilutę"
                        disabled={submitting}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setLines((p) => [...p, emptyLine()])} disabled={submitting}>
              <Plus size={14} /> Pridėti eilutę
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Be PVM · vienetas: {settings?.default_unit_name ?? "—"}</span>
            <span className="text-lg font-bold text-slate-900">Iš viso {formatMoney(centsToNumber(totalCents))}</span>
          </div>

          {(error || result?.status === "failed") && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Nepavyko sukurti sąskaitos. {error ?? result?.sync_error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={submitting || link?.state !== "linked"}>
              {submitting ? "Kuriama sąskaita..." : error || result?.status === "failed" ? "Bandyti dar kartą" : "Išrašyti sąskaitą"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function ClientLinkPanel({
  link,
  busy,
  clientName,
  onLink,
}: {
  link: ClientLinkState | null;
  busy: boolean;
  clientName: string;
  onLink: (invoice123ClientId: string | null) => void;
}) {
  if (!link) return <p className="text-sm text-slate-500">{busy ? "Tikrinamas klientas Sąskaita123..." : ""}</p>;
  if (link.state === "linked") {
    return (
      <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <Link2 size={14} /> Klientas susietas su Sąskaita123.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <p className="text-amber-900">
        „{clientName}“ dar nesusietas su Sąskaita123.
        {link.candidates.length > 0 ? " Rasti galimi atitikmenys — pasirinkite, jei tai tas pats klientas:" : ""}
      </p>
      {link.candidates.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2">
          <div>
            <div className="font-medium text-slate-900">{c.name}</div>
            <div className="text-xs text-slate-500">
              {[c.code, c.vatCode, c.address].filter(Boolean).join(" · ") || "be kodo"} · sutampa pagal{" "}
              {c.matchedBy === "code" ? "įmonės kodą" : "pavadinimą"}
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onLink(c.id)}>
            Susieti
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" disabled={busy} onClick={() => onLink(null)}>
        <UserPlus size={14} /> {busy ? "Vykdoma..." : "Sukurti naują klientą Sąskaita123"}
      </Button>
    </div>
  );
}
