"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound, Link2, Link2Off, PlugZap, RefreshCw, Receipt } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import type { Invoice123Status } from "@/lib/invoice123/settings";
import type { Invoice123RemoteOptions } from "@/lib/invoice123/types";
import {
  connectInvoice123Action,
  disconnectInvoice123Action,
  getInvoice123StatusAction,
  saveInvoice123DefaultsAction,
  syncInvoice123ConfigurationAction,
  testInvoice123ConnectionAction,
} from "./actions";

type Notice = { tone: "ok" | "error"; text: string } | null;

const LANGUAGES = [
  { value: "lt", label: "Lietuvių" },
  { value: "en", label: "Anglų" },
];

const EMPTY_FORM = {
  enabled: false,
  seriesId: "",
  unitId: "",
  bankId: "",
  activityId: "",
  vatId: "",
  expenseTypeId: "",
  language: "lt",
  paymentTermDays: "30",
  issuedBy: "",
};

function formFromStatus(status: Invoice123Status) {
  const s = status.settings;
  if (!s) return EMPTY_FORM;
  const opts = s.remote_options;
  // Suggestions only for unambiguous cases; nothing is stored until "Išsaugoti".
  const onlySimpleSeries = opts?.series.filter((x) => x.type === "simple");
  return {
    enabled: s.enabled,
    seriesId: s.default_series_id ?? (onlySimpleSeries?.length === 1 ? onlySimpleSeries[0].id : ""),
    unitId: s.default_unit_id ?? "",
    bankId: s.default_bank_id ?? opts?.banks.find((b) => b.default)?.id ?? "",
    activityId: s.default_activity_id ?? "",
    vatId: s.default_vat_id ?? "",
    expenseTypeId: s.default_expense_type_id ?? (opts?.expense_types?.length === 1 ? opts.expense_types[0].id : ""),
    language: s.default_language,
    paymentTermDays: String(s.default_payment_term_days),
    issuedBy: s.issued_by ?? "",
  };
}

export default function Invoice123SettingsPage() {
  const [status, setStatus] = useState<Invoice123Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [token, setToken] = useState("");
  const [replacingToken, setReplacingToken] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function applyStatus(next: Invoice123Status) {
    setStatus(next);
    setForm(formFromStatus(next));
  }

  useEffect(() => {
    getInvoice123StatusAction().then((res) => {
      if (res.ok) applyStatus(res.data);
      else setLoadError(res.error);
    });
  }, []);

  function run<T>(op: string, action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (data: T) => string | void) {
    setPendingOp(op);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      setPendingOp(null);
      if (!res.ok) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      const msg = onOk(res.data);
      if (msg) setNotice({ tone: "ok", text: msg });
    });
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    run("connect", () => connectInvoice123Action(token), (data) => {
      applyStatus(data);
      setToken("");
      setReplacingToken(false);
      return "API raktas išsaugotas, nustatymai sinchronizuoti. Pasirinkite numatytąsias reikšmes ir išsaugokite.";
    });
  }

  function handleDisconnect() {
    if (!confirm("Atjungti Sąskaita123? API raktas bus ištrintas, integracija išjungta.")) return;
    run("disconnect", disconnectInvoice123Action, (data) => {
      applyStatus(data);
      return "Sąskaita123 atjungta.";
    });
  }

  function handleTest() {
    run("test", testInvoice123ConnectionAction, (data) => {
      getInvoice123StatusAction().then((res) => res.ok && setStatus(res.data));
      return `Sėkmingai prisijungta prie Sąskaita123. Klientų Sąskaita123 paskyroje: ${data.clientCount}.`;
    });
  }

  function handleSync() {
    run("sync", syncInvoice123ConfigurationAction, (data) => {
      applyStatus(data);
      return "Nustatymai sinchronizuoti su Sąskaita123.";
    });
  }

  function handleSaveDefaults(e: React.FormEvent) {
    e.preventDefault();
    run(
      "save",
      () =>
        saveInvoice123DefaultsAction({
          enabled: form.enabled,
          seriesId: form.seriesId || null,
          unitId: form.unitId || null,
          bankId: form.bankId || null,
          activityId: form.activityId || null,
          vatId: form.vatId || null,
          expenseTypeId: form.expenseTypeId || null,
          language: form.language,
          paymentTermDays: Number(form.paymentTermDays),
          issuedBy: form.issuedBy,
        }),
      (data) => {
        applyStatus(data);
        return "Išsaugota.";
      }
    );
  }

  const settings = status?.settings ?? null;
  const options: Invoice123RemoteOptions | null = settings?.remote_options ?? null;
  const busy = pendingOp !== null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Sąskaita123 integracija"
        description="Sąskaitų išrašymas tiesiai iš EQ VET į jūsų Sąskaita123 paskyrą."
      />

      {loadError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

      {notice && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </p>
      )}

      {!status && !loadError ? (
        <div className="text-sm text-slate-500">Kraunama...</div>
      ) : status ? (
        <div className="space-y-5">
          <Card
            title="Ryšys"
            titleIcon={<PlugZap size={16} className="text-slate-500" />}
            actions={<StatusBadge status={status} />}
          >
            {status.hasToken && !replacingToken ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Row label="API raktas">
                    <span className="font-mono">••••••••{status.tokenHint}</span>
                  </Row>
                  <Row label="PVM mokėtojas">
                    {settings?.company_vat_enabled == null ? "—" : settings.company_vat_enabled ? "Taip" : "Ne"}
                  </Row>
                  <Row label="Paskutinė sinchronizacija">{formatDateTime(settings?.last_config_sync_at)}</Row>
                  <Row label="Paskutinis sėkmingas ryšys">{formatDateTime(settings?.last_connection_ok_at)}</Row>
                </dl>

                {settings?.last_error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Paskutinė klaida: {settings.last_error}
                  </p>
                )}
                {options && options.unavailable.length > 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    API raktas neturi teisės skaityti: {options.unavailable.join(", ")}.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={handleTest} disabled={busy}>
                    <Link2 size={16} /> {pendingOp === "test" ? "Tikrinama..." : "Testuoti ryšį"}
                  </Button>
                  <Button variant="secondary" onClick={handleSync} disabled={busy}>
                    <RefreshCw size={16} className={pendingOp === "sync" ? "animate-spin" : ""} />
                    {pendingOp === "sync" ? "Sinchronizuojama..." : "Sinchronizuoti nustatymus"}
                  </Button>
                  <Button variant="ghost" onClick={() => setReplacingToken(true)} disabled={busy}>
                    <KeyRound size={16} /> Pakeisti raktą
                  </Button>
                  <Button variant="ghost" onClick={handleDisconnect} disabled={busy} className="text-red-600 hover:bg-red-50">
                    <Link2Off size={16} /> Atjungti
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="space-y-3">
                <p className="text-sm text-slate-600">
                  Sąskaita123 → Nustatymai → API sukurkite raktą su teisėmis <code>client:index</code>,{" "}
                  <code>client:store</code>, <code>invoice:index</code>, <code>invoice:store</code> ir įklijuokite jį
                  čia. Raktas saugomas užšifruotas ir niekada nerodomas naršyklėje.
                </p>
                <Input
                  label="API raktas"
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  {replacingToken && (
                    <Button type="button" variant="secondary" onClick={() => setReplacingToken(false)} disabled={busy}>
                      Atšaukti
                    </Button>
                  )}
                  <Button type="submit" disabled={busy || !token.trim()}>
                    {pendingOp === "connect" ? "Tikrinama..." : "Prisijungti"}
                  </Button>
                </div>
              </form>
            )}
          </Card>

          {status.hasToken && options && (
            <Card title="Numatytieji sąskaitų nustatymai" titleIcon={<Receipt size={16} className="text-slate-500" />}>
              <form onSubmit={handleSaveDefaults} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    label="Sąskaitų serija"
                    required={form.enabled}
                    value={form.seriesId}
                    onChange={(e) => setForm({ ...form, seriesId: e.target.value })}
                  >
                    <option value="">— pasirinkite —</option>
                    {options.series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} ({s.type})
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Numatytasis vienetas"
                    required={form.enabled}
                    value={form.unitId}
                    onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                  >
                    <option value="">— pasirinkite —</option>
                    {options.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Banko sąskaita"
                    value={form.bankId}
                    onChange={(e) => setForm({ ...form, bankId: e.target.value })}
                  >
                    <option value="">— nenurodyti —</option>
                    {options.banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} {b.account}
                      </option>
                    ))}
                  </Select>
                  {options.activities.length > 0 && (
                    <Select
                      label="Veikla"
                      value={form.activityId}
                      onChange={(e) => setForm({ ...form, activityId: e.target.value })}
                    >
                      <option value="">— nenurodyti —</option>
                      {options.activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? a.title ?? a.id}
                        </option>
                      ))}
                    </Select>
                  )}
                  {settings?.company_vat_enabled && (
                    <Select
                      label="Numatytasis PVM"
                      value={form.vatId}
                      onChange={(e) => setForm({ ...form, vatId: e.target.value })}
                    >
                      <option value="">— be PVM —</option>
                      {options.vats.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.vat_code} ({((Number(v.tariff) - 1) * 100).toFixed(0)} %)
                        </option>
                      ))}
                    </Select>
                  )}
                  <Select
                    label="Pirkimų išlaidų tipas"
                    value={form.expenseTypeId}
                    onChange={(e) => setForm({ ...form, expenseTypeId: e.target.value })}
                  >
                    <option value="">— pasirinkite —</option>
                    {settings?.default_expense_type_id &&
                      !options.expense_types?.some((t) => t.id === settings.default_expense_type_id) && (
                        <option value={settings.default_expense_type_id}>
                          {settings.default_expense_type_name || settings.default_expense_type_id}
                        </option>
                      )}
                    {(options.expense_types ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        naudotas pvz. „{t.example}“ ({t.uses}×)
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Kalba"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Mokėjimo terminas (d.)"
                    type="number"
                    min={0}
                    max={365}
                    required
                    value={form.paymentTermDays}
                    onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })}
                  />
                  <Input
                    label="Sąskaitą išrašė"
                    placeholder="pvz. vet. gyd. Vardas Pavardė"
                    value={form.issuedBy}
                    onChange={(e) => setForm({ ...form, issuedBy: e.target.value })}
                  />
                </div>

                {(options.expense_types ?? []).length === 0 && (
                  <p className="text-xs text-amber-700">
                    Pirkimams siųsti reikia išlaidų tipo. Sąskaita123 API neteikia jų sąrašo — įveskite bent vieną
                    pirkimą Sąskaita123 ir spauskite „Sinchronizuoti nustatymus“.
                  </p>
                )}

                {!settings?.company_vat_enabled && (
                  <p className="text-xs text-slate-500">
                    Sąskaita123 paskyra nėra PVM mokėtojo — sąskaitos bus išrašomos be PVM.
                  </p>
                )}

                <label className="flex items-center gap-2 pt-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Integracija aktyvi (galima išrašyti sąskaitas iš EQ VET)
                </label>

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={busy}>
                    {pendingOp === "save" ? "Saugoma..." : "Išsaugoti"}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: Invoice123Status }) {
  if (!status.hasToken) return <Badge>Neprijungta</Badge>;
  if (status.settings?.enabled) return <Badge className="bg-emerald-50 text-emerald-700">● Aktyvi</Badge>;
  return <Badge className="bg-amber-50 text-amber-700">Prijungta, neaktyvi</Badge>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 sm:block sm:border-0 sm:py-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}
