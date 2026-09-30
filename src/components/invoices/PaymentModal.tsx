"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import type { Database } from "@/lib/database.types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DateInput, Input, Select } from "@/components/ui/Field";
import { formatMoney, todayISO } from "@/lib/format";
import { centsToString, toCents } from "@/lib/money";
import { PAYMENT_TYPE_LABELS } from "@/lib/labels";
import { addPaymentAction } from "@/app/(app)/sales-invoices/actions";

type SalesInvoice = Database["public"]["Tables"]["sales_invoices"]["Row"];

const TYPES = ["transfer", "cash", "other"] as const;

export function PaymentModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: SalesInvoice | null;
  onClose: () => void;
  onSaved: (invoice: SalesInvoice) => void;
}) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("transfer");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingCents = invoice ? Math.max(0, (toCents(invoice.total) ?? 0) - (toCents(invoice.paid_total) ?? 0)) : 0;

  useEffect(() => {
    if (!invoice) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setKey(crypto.randomUUID());
    setType("transfer");
    setDate(todayISO());
    setAmount(centsToString(remainingCents));
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice || saving) return;
    setSaving(true);
    setError(null);
    const res = await addPaymentAction({ invoiceId: invoice.id, idempotencyKey: key, type, amount, date });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      setKey(crypto.randomUUID()); // the failed attempt is recorded; a retry is a new payment
      return;
    }
    onSaved(res.data);
  }

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title={invoice ? `Mokėjimas · ${invoice.series_title ?? ""} ${invoice.series_number ?? ""}` : ""}
      icon={<Wallet size={18} />}
    >
      {invoice && (
        <form onSubmit={submit} className="space-y-3">
          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Suma</dt>
              <dd className="font-medium">{formatMoney(invoice.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Apmokėta</dt>
              <dd className="font-medium">{formatMoney(invoice.paid_total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Likutis</dt>
              <dd className="font-medium">{formatMoney(Number(centsToString(remainingCents)))}</dd>
            </div>
          </dl>
          <Select label="Mokėjimo būdas" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <DateInput label="Data" required value={date} onChange={setDate} />
            <Input label="Suma, €" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saugoma..." : "Patvirtinti"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
