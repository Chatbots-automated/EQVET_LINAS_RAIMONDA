import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import type { TenantId } from "@/lib/tenant";
import { decryptToken, encryptToken, tokenHint } from "./crypto";
import { Invoice123Error } from "./errors";

export type Invoice123Settings = Database["public"]["Tables"]["invoice123_settings"]["Row"];

export interface Invoice123Config {
  settings: Invoice123Settings | null;
  token: string;
}

// Uses the service_role client because invoice123_credentials has no RLS
// policies. Safe only because tenantId is branded — it can only come from
// requireTenant() — and every query below is filtered by it.

export async function loadInvoice123Config(tenantId: TenantId): Promise<Invoice123Config> {
  const admin = createAdminClient();
  const [{ data: creds, error: credsError }, { data: settings, error: settingsError }] = await Promise.all([
    admin.from("invoice123_credentials").select("token_ciphertext").eq("user_id", tenantId).maybeSingle(),
    admin.from("invoice123_settings").select("*").eq("user_id", tenantId).maybeSingle(),
  ]);
  if (credsError) throw credsError;
  if (settingsError) throw settingsError;

  if (!creds) {
    throw new Invoice123Error({ code: "not_configured", message: `No Invoice123 token for tenant ${tenantId}` });
  }
  return { settings, token: decryptToken(creds.token_ciphertext) };
}

export async function getTokenHint(tenantId: TenantId): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoice123_credentials")
    .select("token_hint")
    .eq("user_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data?.token_hint ?? null;
}

export async function saveToken(tenantId: TenantId, token: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("invoice123_credentials").upsert(
    { user_id: tenantId, token_ciphertext: encryptToken(token), token_hint: tokenHint(token) },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

export async function deleteToken(tenantId: TenantId): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("invoice123_credentials").delete().eq("user_id", tenantId);
  if (error) throw error;
}

export type ReadyInvoice123Settings = Invoice123Settings & { default_series_id: string; default_unit_id: string };

/** Throws unless the tenant's integration is switched on and has the defaults every invoice needs. */
export function assertReadyForInvoicing(settings: Invoice123Settings | null): asserts settings is ReadyInvoice123Settings {
  if (!settings?.enabled) {
    throw new Invoice123Error({ code: "disabled", message: "Invoice123 integration disabled" });
  }
  if (!settings.default_series_id || !settings.default_unit_id) {
    throw new Invoice123Error({ code: "misconfigured", message: "Invoice123 default series/unit not set" });
  }
}
