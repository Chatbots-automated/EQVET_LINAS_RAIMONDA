"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Pencil, Plus, PawPrint, Receipt, RefreshCw, Trash2, Upload, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import {
  createInvoice123ClientAction,
  importInvoice123ClientsAction,
  linkClientAction,
  pushClientToInvoice123Action,
} from "@/app/(app)/sales-invoices/actions";
import { ClientLinkPanel } from "@/components/invoices/InvoiceDraftModal";
import type { ClientLinkState } from "@/lib/invoice123/clients";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type SourceFilter = "all" | "invoice123" | "manual";

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "Visi" },
  { value: "invoice123", label: "Iš Invoice123" },
  { value: "manual", label: "Sukurti rankiniu būdu" },
];

const EMPTY_FORM = {
  name: "",
  address: "",
  phone: "",
  email: "",
  is_company: false,
  company_code: "",
  vat_code: "",
  notes: "",
};

export default function ClientsPage() {
  const supabase = createClient();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [animalCounts, setAnimalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  // Same-name matches found in Invoice123 — the user decides: link or create new.
  const [linkChoice, setLinkChoice] = useState<{ client: { id: string; name: string }; link: ClientLinkState } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: animals }] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("animals").select("client_id").not("client_id", "is", null),
    ]);
    setClients(c ?? []);
    const counts: Record<string, number> = {};
    for (const a of animals ?? []) {
      if (a.client_id) counts[a.client_id] = (counts[a.client_id] ?? 0) + 1;
    }
    setAnimalCounts(counts);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Keep the list mirrored with Invoice123 (new / changed / deleted there).
    syncFromInvoice123({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(c: ClientRow) {
    setEditing(c);
    setForm({
      name: c.name,
      address: c.address ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      is_company: c.is_company,
      company_code: c.company_code ?? "",
      vat_code: c.vat_code ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      is_company: form.is_company,
      company_code: form.is_company ? form.company_code.trim() || null : null,
      vat_code: form.is_company ? form.vat_code.trim() || null : null,
      notes: form.notes.trim() || null,
    };

    const { data: saved, error } = editing
      ? await supabase.from("clients").update(payload).eq("id", editing.id).select("id, name").single()
      : await supabase.from("clients").insert(payload).select("id, name").single();

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setModalOpen(false);
    await load();
    // New clients go straight to Invoice123 (edits can't — the API has no client update).
    if (!editing && saved) await pushToInvoice123(saved);
  }

  async function pushToInvoice123(c: { id: string; name: string }) {
    setPushingId(c.id);
    setSyncNotice(null);
    const res = await pushClientToInvoice123Action(c.id);
    setPushingId(null);
    if (!res.ok) {
      setSyncNotice({ tone: "error", text: `Klientas „${c.name}“ išsaugotas EQ VET, bet neįkeltas į Sąskaita123: ${res.error}` });
      return;
    }
    if (res.data.state === "linked") {
      setSyncNotice({ tone: "ok", text: `Klientas „${c.name}“ įkeltas į Sąskaita123.` });
      load();
    } else if (res.data.state === "unlinked") {
      setLinkChoice({ client: c, link: res.data });
    }
  }

  async function resolveLinkChoice(invoice123ClientId: string | null) {
    if (!linkChoice) return;
    setLinkBusy(true);
    const { client } = linkChoice;
    const res = invoice123ClientId
      ? await linkClientAction(client.id, invoice123ClientId)
      : await createInvoice123ClientAction(client.id);
    setLinkBusy(false);
    if (!res.ok) {
      setSyncNotice({ tone: "error", text: res.error });
      return;
    }
    setLinkChoice(null);
    setSyncNotice({
      tone: "ok",
      text: invoice123ClientId ? `Klientas „${client.name}“ susietas su esamu Sąskaita123 klientu.` : `Klientas „${client.name}“ sukurtas Sąskaita123.`,
    });
    load();
  }

  // silent: automatic sync on page open — no "nothing changed" message, and
  // no error for tenants that haven't connected Invoice123 yet.
  async function syncFromInvoice123({ silent = false } = {}) {
    setSyncing(true);
    if (!silent) setSyncNotice(null);
    const res = await importInvoice123ClientsAction();
    setSyncing(false);
    if (!res.ok) {
      if (!silent) setSyncNotice({ tone: "error", text: res.error });
      return;
    }
    const { inserted, updated, linked, removed, unlinked } = res.data;
    const parts = [
      inserted && `${inserted} nauji`,
      updated && `${updated} atnaujinti`,
      linked && `${linked} susieti su esamais`,
      removed.length && `pašalinti (ištrinti Sąskaita123): ${removed.join(", ")}`,
      unlinked.length &&
        `atsieti, bet palikti EQ VET, nes turi gyvūnų ar sąskaitų (ištrinti Sąskaita123): ${unlinked.join(", ")}`,
    ].filter(Boolean);
    if (parts.length) {
      setSyncNotice({ tone: "ok", text: `Sąskaita123 klientai: ${parts.join("; ")}.` });
      load();
    } else if (!silent) {
      setSyncNotice({ tone: "ok", text: "Klientai sutampa su Sąskaita123 — pakeitimų nėra." });
    }
  }

  async function handleDelete(c: ClientRow) {
    if (!confirm(`Ištrinti klientą "${c.name}"? Susieti gyvūnai liks, bet be kliento.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) {
      alert(`Nepavyko ištrinti: ${error.message}`);
      return;
    }
    load();
  }

  const q = search.trim().toLowerCase();
  const filtered = clients.filter((c) => {
    if (sourceFilter === "invoice123" && c.external_source !== "invoice123") return false;
    if (sourceFilter === "manual" && c.external_source) return false;
    if (!q) return true;
    return [c.name, c.company_code, c.vat_code, c.address].some((v) => v?.toLowerCase().includes(q));
  });

  return (
    <div>
      <PageHeader
        title="Klientai"
        actions={
          <>
            <Button variant="secondary" onClick={() => syncFromInvoice123()} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Sinchronizuojama..." : "Sinchronizuoti su Sąskaita123"}
            </Button>
            <Button onClick={openCreate}>
              <Plus size={16} /> Naujas klientas
            </Button>
          </>
        }
      />

      {syncNotice && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${syncNotice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {syncNotice.text}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Ieškoti pagal pavadinimą, kodą, adresą..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSourceFilter(f.value)}
              className={`rounded-md px-3 py-1 text-sm ${
                sourceFilter === f.value
                  ? "bg-emerald-50 font-medium text-emerald-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Klientų dar nėra. Pridėkite pirmąjį." />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Pavadinimas</th>
                <th className="px-5 py-3">Įmonės / PVM kodas</th>
                <th className="px-5 py-3">Adresas</th>
                <th className="px-5 py-3">Telefonas</th>
                <th className="px-5 py-3">El. paštas</th>
                <th className="px-5 py-3">Gyvūnai</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    <Link href={`/clients/${c.id}`} className="hover:text-emerald-700 hover:underline" title="Kliento kortelė: gyvūnai, vizitai, sąskaitos">
                      {c.name}
                    </Link>
                    {c.is_company && (
                      <Badge className="ml-2 bg-indigo-50 text-indigo-700">Juridinis</Badge>
                    )}
                    {c.external_source === "invoice123" && (
                      <Badge className="ml-2 bg-amber-50 text-amber-700">Invoice123</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.company_code || c.vat_code ? (
                      <>
                        <div>{c.company_code ?? "—"}</div>
                        {c.vat_code && <div className="text-xs text-slate-500">{c.vat_code}</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.address ?? "—"}
                    {c.country_code && c.country_code !== "LT" && (
                      <span className="ml-1 text-xs text-slate-500">({c.country_code})</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{animalCounts[c.id] ?? 0}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {c.external_source !== "invoice123" && (
                        <button
                          onClick={() => pushToInvoice123(c)}
                          disabled={pushingId === c.id}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-700 disabled:animate-pulse"
                          title="Įkelti į Sąskaita123"
                          aria-label="Įkelti į Sąskaita123"
                        >
                          <Upload size={16} />
                        </button>
                      )}
                      <Link
                        href={`/sales-invoices?client=${c.id}`}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Sąskaitos"
                      >
                        <Receipt size={16} />
                      </Link>
                      <Link
                        href={`/animals?client=${c.id}`}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Gyvūnai"
                      >
                        <PawPrint size={16} />
                      </Link>
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Redaguoti"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        aria-label="Ištrinti"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!linkChoice}
        onClose={() => setLinkChoice(null)}
        title="Įkėlimas į Sąskaita123"
        icon={<Link2 size={18} />}
        iconClassName="bg-sky-50 text-sky-700"
      >
        {linkChoice && (
          <ClientLinkPanel
            link={linkChoice.link}
            busy={linkBusy}
            clientName={linkChoice.client.name}
            onLink={resolveLinkChoice}
          />
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Redaguoti klientą" : "Naujas klientas"}
        icon={<Users size={18} />}
        iconClassName="bg-indigo-50 text-indigo-600"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="Pavadinimas"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Adresas"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Telefonas"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="El. paštas"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_company}
              onChange={(e) => setForm({ ...form, is_company: e.target.checked })}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Juridinis asmuo
          </label>

          {form.is_company && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Input
                label="Įmonės kodas"
                value={form.company_code}
                onChange={(e) => setForm({ ...form, company_code: e.target.value })}
              />
              <Input
                label="PVM kodas"
                value={form.vat_code}
                onChange={(e) => setForm({ ...form, vat_code: e.target.value })}
              />
            </div>
          )}

          <Textarea
            label="Pastabos"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          {editing?.external_source === "invoice123" && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Šis klientas susietas su Sąskaita123. Pakeitimai išsaugomi tik EQ VET — Sąskaita123 neleidžia
              redaguoti klientų per API, todėl juos pakeiskite ir Sąskaita123.
            </p>
          )}
          {!editing && (
            <p className="text-xs text-slate-500">Išsaugojus klientas bus automatiškai įkeltas į Sąskaita123.</p>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saugoma..." : "Išsaugoti"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
