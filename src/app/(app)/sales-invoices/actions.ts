"use server";

import { runAction } from "@/lib/action-result";
import { requireTenant } from "@/lib/tenant";
import * as clients from "@/lib/invoice123/clients";
import * as invoices from "@/lib/invoice123/invoices";
import * as payments from "@/lib/invoice123/payments";
import * as expenses from "@/lib/invoice123/expenses";
import type { CreateInvoiceInput } from "@/lib/invoice123/invoices";
import type { AddPaymentInput } from "@/lib/invoice123/payments";
import type { SendPurchaseInput } from "@/lib/invoice123/expenses";

// Tenant always comes from the verified session. IDs sent by the browser
// (client, invoice, visit) are only references — every service function
// re-checks that they belong to this tenant before using them.

export async function importInvoice123ClientsAction() {
  return runAction("invoice123.import-clients", async () => clients.importClients(await requireTenant()));
}

export async function getClientLinkStateAction(clientId: string) {
  return runAction("invoice123.client-link-state", async () =>
    clients.getClientLinkState(await requireTenant(), String(clientId))
  );
}

export async function linkClientAction(clientId: string, invoice123ClientId: string) {
  return runAction("invoice123.link-client", async () =>
    clients.linkClient(await requireTenant(), String(clientId), String(invoice123ClientId))
  );
}

export async function createInvoice123ClientAction(clientId: string) {
  return runAction("invoice123.create-client", async () =>
    clients.createClientInInvoice123(await requireTenant(), String(clientId))
  );
}

export async function pushClientToInvoice123Action(clientId: string) {
  return runAction("invoice123.push-client", async () => clients.pushClient(await requireTenant(), String(clientId)));
}

export async function createInvoiceAction(input: CreateInvoiceInput) {
  return runAction("invoice123.create-invoice", async () =>
    invoices.createInvoice(await requireTenant(), {
      idempotencyKey: String(input?.idempotencyKey ?? ""),
      clientId: String(input?.clientId ?? ""),
      visitIds: Array.isArray(input?.visitIds) ? input.visitIds.map(String) : [],
      date: String(input?.date ?? ""),
      dateDue: input?.dateDue ? String(input.dateDue) : null,
      lines: Array.isArray(input?.lines)
        ? input.lines.map((l) => ({
            title: String(l?.title ?? ""),
            description: l?.description ? String(l.description) : null,
            quantity: String(l?.quantity ?? ""),
            unitPrice: String(l?.unitPrice ?? ""),
            productId: l?.productId ? String(l.productId) : null,
          }))
        : [],
    })
  );
}

export async function reconcileInvoiceAction(invoiceId: string) {
  return runAction("invoice123.reconcile", async () => invoices.reconcileInvoice(await requireTenant(), String(invoiceId)));
}

export async function importInvoicesAction() {
  return runAction("invoice123.import-invoices", async () => invoices.importInvoices(await requireTenant()));
}

export async function addPaymentAction(input: AddPaymentInput) {
  return runAction("invoice123.add-payment", async () =>
    payments.addPayment(await requireTenant(), {
      invoiceId: String(input?.invoiceId ?? ""),
      idempotencyKey: String(input?.idempotencyKey ?? ""),
      type: String(input?.type ?? ""),
      amount: String(input?.amount ?? ""),
      date: String(input?.date ?? ""),
    })
  );
}

export async function sendPurchaseAction(input: SendPurchaseInput) {
  return runAction("invoice123.send-purchase", async () =>
    expenses.sendPurchase(await requireTenant(), {
      purchaseId: String(input?.purchaseId ?? ""),
      vatRates: Array.isArray(input?.vatRates)
        ? input.vatRates.map((v) => ({ itemId: String(v?.itemId ?? ""), vatRate: Number(v?.vatRate) }))
        : [],
    })
  );
}

export async function reconcilePurchaseAction(purchaseId: string) {
  return runAction("invoice123.reconcile-purchase", async () =>
    expenses.reconcilePurchase(await requireTenant(), String(purchaseId))
  );
}

export async function refreshPurchasesAction() {
  return runAction("invoice123.refresh-purchases", async () => expenses.refreshPurchases(await requireTenant()));
}
