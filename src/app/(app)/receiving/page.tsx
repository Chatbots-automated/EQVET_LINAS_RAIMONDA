"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, FileUp, Loader2, Package, Plus, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database, Unit } from "@/lib/database.types";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Field";
import { UNIT_LABELS } from "@/lib/labels";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { EMPTY_PRODUCT_FORM, ProductFormFields, productFormToPayload } from "@/components/ProductFormFields";

type Product = Database["public"]["Tables"]["products"]["Row"];
type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];
type BatchRow = Database["public"]["Views"]["stock_by_batch"]["Row"];

const WEBHOOK_URL = process.env.NEXT_PUBLIC_INVOICE_WEBHOOK_URL || "";

// Shape produced by the n8n invoice-OCR workflow (see supabase/scripts or the
// workflow export) — response body is the payload object directly.
interface WebhookSupplier {
  name: string;
  code?: string | null;
  vat_code?: string | null;
  iban?: string | null;
  address?: string | null;
}
interface WebhookInvoice {
  number?: string | null;
  date?: string | null;
  currency?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  total_net?: number | null;
  total_vat?: number | null;
  total_gross?: number | null;
  vat_rate?: number | null;
}
interface WebhookItem {
  line_no?: number;
  sku?: string | null;
  description: string;
  qty: number | null;
  unit?: string | null;
  unit_price?: number | null;
  discount?: number | null;
  net?: number | null;
  vat_rate?: number | null;
  vat?: number | null;
  gross?: number | null;
  batch?: string | null;
  expiry?: string | null;
}
interface WebhookResponse {
  supplier: WebhookSupplier;
  invoice: WebhookInvoice;
  items: WebhookItem[];
  totals_check?: { calc_net: number; calc_vat: number; calc_gross: number };
  line_count?: number;
}

interface ReviewRow {
  include: boolean;
  description: string;
  sku: string;
  product_id: string;
  lot: string;
  expiry_date: string;
  quantity: string;
  unit_price: string;
  net: string;
}

const EMPTY_MANUAL_FORM = {
  product_id: "",
  supplier_id: "",
  lot: "",
  mfg_date: "",
  expiry_date: "",
  doc_number: "",
  doc_date: new Date().toISOString().slice(0, 10),
  purchase_price: "",
  package_count: "",
  received_qty: "",
  unit: "" as Unit | "",
};

const EMPTY_QUICK_SUPPLIER = { name: "", code: "", vat_code: "" };

export default function ReceivingPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<"manual" | "pdf">(WEBHOOK_URL ? "pdf" : "manual");

  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [recentBatches, setRecentBatches] = useState<BatchRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);

  // --- manual form state ---
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // --- pdf import state ---
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [webhookData, setWebhookData] = useState<WebhookResponse | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // --- quick product / supplier creation ---
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductForm, setQuickProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [quickProductTarget, setQuickProductTarget] = useState<"manual" | number | null>(null);
  const [quickProductSaving, setQuickProductSaving] = useState(false);
  // Only shown when creating a product from a PDF-import row: pakuotės dydis
  // (quickProductForm.package_size) × pakuočių kiekis → total, feeding that
  // row's Kiekis field.
  const [quickReceivingPackageCount, setQuickReceivingPackageCount] = useState("");
  const [quickReceivingTotalQty, setQuickReceivingTotalQty] = useState("");

  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickSupplierForm, setQuickSupplierForm] = useState(EMPTY_QUICK_SUPPLIER);
  const [quickSupplierSaving, setQuickSupplierSaving] = useState(false);

  async function loadReference() {
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from("products").select("*").eq("is_active", true).order("name"),
      supabase.from("suppliers").select("*").order("name"),
    ]);
    setProducts(p ?? []);
    setSuppliers(s ?? []);
  }

  async function loadLog() {
    setLoadingLog(true);
    const { data } = await supabase
      .from("stock_by_batch")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    setRecentBatches(data ?? []);
    setLoadingLog(false);
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    loadReference();
    loadLog();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  function findProductMatch(description: string): string {
    const lower = description.toLowerCase();
    const match = products.find(
      (p) => lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(lower)
    );
    return match?.id ?? "";
  }

  // ---------------- manual submit ----------------

  const selectedManualProduct = useMemo(
    () => products.find((p) => p.id === manualForm.product_id),
    [products, manualForm.product_id]
  );

  function handlePackageCountChange(value: string) {
    const packageSize = selectedManualProduct?.package_size;
    const count = Number(value);
    const nextReceivedQty =
      packageSize && count > 0 ? String(packageSize * count) : manualForm.received_qty;
    setManualForm((f) => ({ ...f, package_count: value, received_qty: nextReceivedQty }));
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);

    const product = products.find((p) => p.id === manualForm.product_id);
    if (!product) {
      setManualError("Pasirinkite produktą.");
      return;
    }
    if (!manualForm.received_qty || Number(manualForm.received_qty) <= 0) {
      setManualError("Įveskite gautą kiekį.");
      return;
    }

    setManualSaving(true);
    const { error } = await supabase.from("batches").insert({
      product_id: product.id,
      supplier_id: manualForm.supplier_id || null,
      lot: manualForm.lot.trim() || null,
      mfg_date: manualForm.mfg_date || null,
      expiry_date: manualForm.expiry_date || null,
      doc_number: manualForm.doc_number.trim() || null,
      doc_date: manualForm.doc_date || null,
      purchase_price: manualForm.purchase_price ? Number(manualForm.purchase_price) : null,
      package_count: manualForm.package_count ? Number(manualForm.package_count) : null,
      received_qty: Number(manualForm.received_qty),
      unit: (manualForm.unit || product.unit) as Unit,
    });

    setManualSaving(false);
    if (error) {
      setManualError(error.message);
      return;
    }

    setManualForm(EMPTY_MANUAL_FORM);
    loadLog();
  }

  // ---------------- pdf upload ----------------

  function handleFileSelect(f: File | null) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setFile(f);
    setPdfUrl(f ? URL.createObjectURL(f) : null);
    if (f) handleUpload(f);
  }

  async function handleUpload(target?: File) {
    const uploadFile = target ?? file;
    if (!uploadFile) return;
    if (!WEBHOOK_URL) {
      setUploadError("Sąskaitų nuskaitymo webhook'as nesukonfigūruotas (NEXT_PUBLIC_INVOICE_WEBHOOK_URL).");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setWebhookData(null);
    setReviewRows([]);

    try {
      const formData = new FormData();
      formData.append("data", uploadFile, uploadFile.name);

      const response = await fetch(WEBHOOK_URL, { method: "POST", body: formData });

      if (!response.ok) throw new Error(`Serverio klaida: ${response.status}`);

      const text = await response.text();
      if (!text.trim()) throw new Error("Serveris grąžino tuščią atsakymą.");

      const parsed = JSON.parse(text);
      const data: WebhookResponse = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!data?.items?.length) throw new Error("Atsakyme nerasta prekių sąrašo.");

      setWebhookData(data);
      setReviewRows(
        data.items.map((item) => ({
          include: true,
          description: item.description,
          sku: item.sku ?? "",
          product_id: findProductMatch(item.description),
          lot: item.batch ?? "",
          expiry_date: item.expiry ?? "",
          quantity: item.qty != null ? String(item.qty) : "",
          unit_price: item.unit_price != null ? String(item.unit_price) : "",
          net: item.net != null ? String(item.net) : "",
        }))
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Nepavyko apdoroti PDF.");
    } finally {
      setUploading(false);
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setReviewRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function resetPdfImport() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setFile(null);
    setPdfUrl(null);
    setWebhookData(null);
    setReviewRows([]);
    setUploadError(null);
    setConfirmError(null);
  }

  async function handleConfirmImport() {
    if (!webhookData) return;
    const included = reviewRows.filter((r) => r.include);

    if (included.length === 0) {
      setConfirmError("Pažymėkite bent vieną prekę.");
      return;
    }
    if (included.some((r) => !r.product_id)) {
      setConfirmError("Kiekvienai pažymėtai prekei būtina priskirti produktą.");
      return;
    }

    setConfirming(true);
    setConfirmError(null);

    try {
      // 1. resolve supplier
      let supplierId: string | null = null;
      const existingSupplier = suppliers.find(
        (s) => s.name.toLowerCase() === webhookData.supplier?.name?.toLowerCase()
      );
      if (existingSupplier) {
        supplierId = existingSupplier.id;
      } else if (webhookData.supplier?.name) {
        const { data: newSupplier, error } = await supabase
          .from("suppliers")
          .insert({
            name: webhookData.supplier.name,
            code: webhookData.supplier.code || null,
            vat_code: webhookData.supplier.vat_code || null,
            iban: webhookData.supplier.iban || null,
            address: webhookData.supplier.address || null,
          })
          .select()
          .single();
        if (error) throw error;
        supplierId = newSupplier.id;
      }

      // 2. create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          invoice_number: webhookData.invoice.number || null,
          invoice_date: webhookData.invoice.date || null,
          supplier_id: supplierId,
          supplier_name: webhookData.supplier?.name || null,
          supplier_code: webhookData.supplier?.code || null,
          supplier_vat: webhookData.supplier?.vat_code || null,
          currency: webhookData.invoice.currency || "EUR",
          total_net: webhookData.invoice.total_net ?? null,
          total_vat: webhookData.invoice.total_vat ?? null,
          total_gross: webhookData.invoice.total_gross ?? null,
          pdf_filename: file?.name || null,
        })
        .select()
        .single();
      if (invoiceError) throw invoiceError;

      // 3. create a batch + invoice_item per included row
      for (const row of included) {
        const product = products.find((p) => p.id === row.product_id);
        if (!product) continue;

        const { data: batch, error: batchError } = await supabase
          .from("batches")
          .insert({
            product_id: product.id,
            supplier_id: supplierId,
            invoice_id: invoice.id,
            lot: row.lot || null,
            expiry_date: row.expiry_date || null,
            doc_number: webhookData.invoice.number || null,
            doc_date: webhookData.invoice.date || null,
            purchase_price: row.net ? Number(row.net) : row.unit_price ? Number(row.unit_price) : null,
            received_qty: Number(row.quantity) || 0,
            unit: product.unit,
          })
          .select()
          .single();
        if (batchError) throw batchError;

        await supabase.from("invoice_items").insert({
          invoice_id: invoice.id,
          batch_id: batch.id,
          description: row.description,
          quantity: Number(row.quantity) || 0,
          unit_price: row.unit_price ? Number(row.unit_price) : null,
          total_price: row.net ? Number(row.net) : null,
        });
      }

      resetPdfImport();
      loadLog();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Nepavyko importuoti sąskaitos.");
    } finally {
      setConfirming(false);
    }
  }

  // ---------------- quick product / supplier creation ----------------

  function openQuickProduct(target: "manual" | number, prefillName = "") {
    setQuickProductTarget(target);
    setQuickProductForm({ ...EMPTY_PRODUCT_FORM, name: prefillName });
    setQuickReceivingPackageCount("");
    setQuickReceivingTotalQty(typeof target === "number" ? reviewRows[target]?.quantity ?? "" : "");
    setQuickProductOpen(true);
  }

  function handleQuickReceivingPackageCountChange(value: string) {
    setQuickReceivingPackageCount(value);
    const size = Number(quickProductForm.package_size) || 0;
    const count = Number(value) || 0;
    if (size && count) setQuickReceivingTotalQty(String(size * count));
  }

  async function handleQuickProductSubmit(e: React.FormEvent) {
    e.preventDefault();
    setQuickProductSaving(true);

    const { data, error } = await supabase
      .from("products")
      .insert(productFormToPayload(quickProductForm))
      .select()
      .single();

    setQuickProductSaving(false);
    if (error || !data) {
      alert(error?.message ?? "Nepavyko sukurti produkto.");
      return;
    }

    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));

    if (quickProductTarget === "manual") {
      setManualForm((f) => ({ ...f, product_id: data.id }));
    } else if (typeof quickProductTarget === "number") {
      updateRow(quickProductTarget, {
        product_id: data.id,
        ...(quickReceivingTotalQty ? { quantity: quickReceivingTotalQty } : {}),
      });
    }

    setQuickProductOpen(false);
  }

  async function handleQuickSupplierSubmit(e: React.FormEvent) {
    e.preventDefault();
    setQuickSupplierSaving(true);

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        name: quickSupplierForm.name.trim(),
        code: quickSupplierForm.code.trim() || null,
        vat_code: quickSupplierForm.vat_code.trim() || null,
      })
      .select()
      .single();

    setQuickSupplierSaving(false);
    if (error || !data) {
      alert(error?.message ?? "Nepavyko sukurti tiekėjo.");
      return;
    }

    setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setManualForm((f) => ({ ...f, supplier_id: data.id }));
    setQuickSupplierOpen(false);
    setQuickSupplierForm(EMPTY_QUICK_SUPPLIER);
  }

  const showSplitLayout = mode === "pdf" && pdfUrl && webhookData;

  return (
    <div>
      <PageHeader title="Pajamavimas" description="Veterinarinių produktų priėmimas į atsargas" />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        <button
          onClick={() => setMode("pdf")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "pdf" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Iš sąskaitos (PDF)
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "manual" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Rankinis įvedimas
        </button>
      </div>

      {mode === "pdf" && (
        <div className={showSplitLayout ? "mb-6 flex flex-col gap-6 lg:flex-row" : "mb-6"}>
          {showSplitLayout && (
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 lg:w-1/2">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText size={16} className="text-emerald-600" />
                PDF sąskaita
              </h3>
              <iframe
                src={pdfUrl!}
                title="Sąskaitos PDF"
                className="h-[70vh] w-full rounded-lg border border-slate-200 lg:h-[calc(100vh-14rem)]"
              />
            </div>
          )}

          <Card className={showSplitLayout ? "flex-1 overflow-y-auto lg:max-h-[calc(100vh-14rem)]" : ""}>
            {!WEBHOOK_URL ? (
              <p className="text-sm text-slate-500">
                Sąskaitų nuskaitymo webhook&apos;as dar nesukonfigūruotas. Nustatykite
                <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5">NEXT_PUBLIC_INVOICE_WEBHOOK_URL</code>
                aplinkos kintamąjį arba naudokite rankinį įvedimą.
              </p>
            ) : !webhookData ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="rounded-full bg-emerald-50 p-3">
                  <FileUp className="text-emerald-600" size={28} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Įkelkite sąskaitos PDF failą</p>
                  <p className="mt-0.5 text-xs text-slate-500">Sistema automatiškai atpažins prekes ir kiekius</p>
                </div>

                <label
                  htmlFor="invoice-pdf-input"
                  className={`flex w-full max-w-sm flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors ${
                    uploading
                      ? "cursor-wait border-emerald-300 bg-emerald-50/40 text-emerald-700"
                      : "cursor-pointer border-slate-300 text-slate-500 hover:border-emerald-400 hover:bg-emerald-50/40"
                  }`}
                >
                  {uploading ? (
                    <span className="flex items-center gap-2 font-medium">
                      <Loader2 size={16} className="animate-spin" /> Nuskaitoma sąskaita...
                    </span>
                  ) : file ? (
                    <span className="truncate font-medium text-slate-700">{file.name}</span>
                  ) : (
                    <span>Spustelėkite, kad pasirinktumėte PDF failą</span>
                  )}
                  <input
                    id="invoice-pdf-input"
                    type="file"
                    accept="application/pdf"
                    disabled={uploading}
                    onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </label>

                {uploadError && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm text-red-600">{uploadError}</p>
                    <Button variant="secondary" onClick={() => handleUpload()}>
                      Bandyti dar kartą
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">Tiekėjas</div>
                    <div className="font-medium">{webhookData.supplier?.name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Sąskaitos Nr.</div>
                    <div className="font-medium">{webhookData.invoice.number || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Data</div>
                    <div className="font-medium">{webhookData.invoice.date || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Suma</div>
                    <div className="font-medium">{formatMoney(webhookData.invoice.total_gross)}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  {reviewRows.map((row, i) => {
                    const matched = !!row.product_id;
                    return (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 transition-colors ${
                        matched ? "border-emerald-300 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="font-medium text-slate-800">{row.description}</span>
                        </label>
                        <div className="flex items-center gap-2">
                          {row.sku && <span className="text-xs text-slate-400">SKU: {row.sku}</span>}
                          {matched ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                              <CheckCircle2 size={13} /> Rasta atitiktis
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                              <Plus size={13} /> Nerasta — sukurkite produktą
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <div className="col-span-2">
                          <label className="text-xs text-slate-500">Produktas</label>
                          <div className="mt-1 flex gap-1">
                            <select
                              value={row.product_id}
                              onChange={(e) => updateRow(i, { product_id: e.target.value })}
                              className={`w-full rounded-lg border bg-white px-2 py-1.5 text-xs ${
                                matched ? "border-emerald-300" : "border-amber-400"
                              }`}
                            >
                              <option value="">— Pasirinkti —</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => openQuickProduct(i, row.description)}
                              className={`shrink-0 rounded-lg border px-2 text-xs font-medium transition-colors ${
                                matched
                                  ? "border-slate-300 text-slate-500 hover:bg-slate-50"
                                  : "border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200"
                              }`}
                              title="Naujas produktas"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">Kiekis</label>
                          <input
                            type="number"
                            step="any"
                            value={row.quantity}
                            onChange={(e) => updateRow(i, { quantity: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">Kaina (be PVM)</label>
                          <input
                            type="number"
                            step="any"
                            value={row.net}
                            onChange={(e) => updateRow(i, { net: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">Galiojimas</label>
                          <input
                            type="date"
                            value={row.expiry_date}
                            onChange={(e) => updateRow(i, { expiry_date: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <div>
                          <label className="text-xs text-slate-500">Partija (lot)</label>
                          <input
                            type="text"
                            value={row.lot}
                            onChange={(e) => updateRow(i, { lot: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">Vnt. kaina</label>
                          <input
                            type="number"
                            step="any"
                            value={row.unit_price}
                            onChange={(e) => updateRow(i, { unit_price: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {confirmError && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{confirmError}</p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={resetPdfImport}>
                    Atšaukti
                  </Button>
                  <Button onClick={handleConfirmImport} disabled={confirming}>
                    <Save size={16} /> {confirming ? "Importuojama..." : "Patvirtinti pajamavimą"}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {mode === "manual" && (
        <Card className="mb-6">
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-end gap-1">
                <Select
                  label="Produktas"
                  required
                  wrapperClassName="flex-1"
                  value={manualForm.product_id}
                  onChange={(e) => setManualForm({ ...manualForm, product_id: e.target.value })}
                >
                  <option value="">— Pasirinkti —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={() => openQuickProduct("manual")}>
                  <Plus size={16} />
                </Button>
              </div>
              <div className="flex items-end gap-1">
                <Select
                  label="Tiekėjas"
                  wrapperClassName="flex-1"
                  value={manualForm.supplier_id}
                  onChange={(e) => setManualForm({ ...manualForm, supplier_id: e.target.value })}
                >
                  <option value="">— Nenurodyta —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={() => setQuickSupplierOpen(true)}>
                  <Plus size={16} />
                </Button>
              </div>
            </div>

            {selectedManualProduct?.package_size ? (
              <p className="text-xs text-slate-500">
                Pakuotės dydis: {formatQty(selectedManualProduct.package_size, selectedManualProduct.unit)} — nurodykite
                kiek pakuočių gauta, o kiekis bus apskaičiuotas automatiškai.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-4">
              <Input
                label="Kiek pakuočių"
                type="number"
                step="any"
                value={manualForm.package_count}
                onChange={(e) => handlePackageCountChange(e.target.value)}
              />
              <Input
                label="Gautas kiekis"
                type="number"
                step="any"
                required
                value={manualForm.received_qty}
                onChange={(e) => setManualForm({ ...manualForm, received_qty: e.target.value })}
              />
              <Select
                label="Vienetas"
                value={manualForm.unit || selectedManualProduct?.unit || ""}
                onChange={(e) => setManualForm({ ...manualForm, unit: e.target.value as Unit })}
              >
                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                label="Pirkimo kaina (viso)"
                type="number"
                step="any"
                value={manualForm.purchase_price}
                onChange={(e) => setManualForm({ ...manualForm, purchase_price: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Partijos Nr. (lot)"
                value={manualForm.lot}
                onChange={(e) => setManualForm({ ...manualForm, lot: e.target.value })}
              />
              <Input
                label="Galiojimo data"
                type="date"
                value={manualForm.expiry_date}
                onChange={(e) => setManualForm({ ...manualForm, expiry_date: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Pagaminimo data"
                type="date"
                value={manualForm.mfg_date}
                onChange={(e) => setManualForm({ ...manualForm, mfg_date: e.target.value })}
              />
              <Input
                label="Dokumento Nr."
                value={manualForm.doc_number}
                onChange={(e) => setManualForm({ ...manualForm, doc_number: e.target.value })}
              />
              <Input
                label="Dokumento data"
                type="date"
                value={manualForm.doc_date}
                onChange={(e) => setManualForm({ ...manualForm, doc_date: e.target.value })}
              />
            </div>

            {manualError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{manualError}</p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={manualSaving}>
                <Package size={16} /> {manualSaving ? "Saugoma..." : "Priimti prekę"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Paskutinės pajamuotos partijos" className="overflow-hidden p-0">
        {loadingLog ? (
          <div className="p-5 text-sm text-slate-500">Kraunama...</div>
        ) : recentBatches.length === 0 ? (
          <div className="p-5">
            <EmptyState message="Dar nėra pajamuotų prekių." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Produktas</th>
                <th className="px-5 py-3">Partija</th>
                <th className="px-5 py-3">Kiekis</th>
                <th className="px-5 py-3">Kaina</th>
                <th className="px-5 py-3">Tiekėjas</th>
                <th className="px-5 py-3">Galiojimas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentBatches.map((b) => (
                <tr key={b.batch_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-600">{formatDate(b.created_at)}</td>
                  <td className="px-5 py-3 font-medium text-slate-900">{b.product_name}</td>
                  <td className="px-5 py-3 text-slate-600">{b.lot ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{formatQty(b.received_qty, b.unit)}</td>
                  <td className="px-5 py-3 text-slate-600">{formatMoney(b.purchase_price)}</td>
                  <td className="px-5 py-3 text-slate-600">{b.supplier_name ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(b.expiry_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={quickProductOpen} onClose={() => setQuickProductOpen(false)} title="Naujas produktas" wide>
        <form onSubmit={handleQuickProductSubmit} className="space-y-3">
          <ProductFormFields form={quickProductForm} onChange={setQuickProductForm} showActiveToggle={false} />

          {typeof quickProductTarget === "number" && (
            <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3">
              <p className="mb-2 text-sm font-semibold text-emerald-900">Priėmimo duomenys iš sąskaitos</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Pakuočių kiekis</label>
                  <input
                    type="number"
                    step="any"
                    value={quickReceivingPackageCount}
                    onChange={(e) => handleQuickReceivingPackageCountChange(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="5"
                  />
                  <p className="mt-0.5 text-xs text-slate-500">kiek pakuočių gauta</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Viso{" "}
                    {quickProductForm.package_size && quickReceivingPackageCount && (
                      <span className="font-bold text-emerald-600">(auto)</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={quickReceivingTotalQty}
                    onChange={(e) => setQuickReceivingTotalQty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold"
                    placeholder="500"
                  />
                  <p className="mt-0.5 text-xs font-medium text-emerald-700">
                    {quickProductForm.package_size && quickReceivingPackageCount
                      ? `${quickReceivingPackageCount} pak × ${quickProductForm.package_size}${quickProductForm.unit}`
                      : "arba įveskite rankiniu būdu"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setQuickProductOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={quickProductSaving}>
              {quickProductSaving ? "Saugoma..." : "Sukurti"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={quickSupplierOpen} onClose={() => setQuickSupplierOpen(false)} title="Naujas tiekėjas">
        <form onSubmit={handleQuickSupplierSubmit} className="space-y-3">
          <Input
            label="Pavadinimas"
            required
            value={quickSupplierForm.name}
            onChange={(e) => setQuickSupplierForm({ ...quickSupplierForm, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Įmonės kodas"
              value={quickSupplierForm.code}
              onChange={(e) => setQuickSupplierForm({ ...quickSupplierForm, code: e.target.value })}
            />
            <Input
              label="PVM kodas"
              value={quickSupplierForm.vat_code}
              onChange={(e) => setQuickSupplierForm({ ...quickSupplierForm, vat_code: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setQuickSupplierOpen(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={quickSupplierSaving}>
              {quickSupplierSaving ? "Saugoma..." : "Sukurti"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
