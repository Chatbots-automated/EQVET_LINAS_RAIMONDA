"use server";

import { runAction } from "@/lib/action-result";
import { requireTenant } from "@/lib/tenant";
import * as invoice123Settings from "@/lib/invoice123/settings";
import type { SaveDefaultsInput } from "@/lib/invoice123/settings";

// Every action resolves the tenant from the verified session. None of them
// accepts a tenant/user id from the browser.

export async function getInvoice123StatusAction() {
  return runAction("invoice123.status", async () => invoice123Settings.getStatus(await requireTenant()));
}

export async function connectInvoice123Action(token: string) {
  return runAction("invoice123.connect", async () =>
    invoice123Settings.connect(await requireTenant(), String(token ?? ""))
  );
}

export async function disconnectInvoice123Action() {
  return runAction("invoice123.disconnect", async () => {
    const ctx = await requireTenant();
    await invoice123Settings.disconnect(ctx);
    return invoice123Settings.getStatus(ctx);
  });
}

export async function testInvoice123ConnectionAction() {
  return runAction("invoice123.test", async () => invoice123Settings.testConnection(await requireTenant()));
}

export async function syncInvoice123ConfigurationAction() {
  return runAction("invoice123.sync-config", async () => {
    const ctx = await requireTenant();
    await invoice123Settings.syncConfiguration(ctx);
    return invoice123Settings.getStatus(ctx);
  });
}

export async function saveInvoice123DefaultsAction(input: SaveDefaultsInput) {
  return runAction("invoice123.save-defaults", async () => {
    const ctx = await requireTenant();
    await invoice123Settings.saveDefaults(ctx, {
      enabled: Boolean(input?.enabled),
      seriesId: input?.seriesId || null,
      unitId: input?.unitId || null,
      bankId: input?.bankId || null,
      activityId: input?.activityId || null,
      vatId: input?.vatId || null,
      expenseTypeId: input?.expenseTypeId || null,
      language: String(input?.language ?? "lt"),
      paymentTermDays: Number(input?.paymentTermDays),
      issuedBy: String(input?.issuedBy ?? ""),
    });
    return invoice123Settings.getStatus(ctx);
  });
}
