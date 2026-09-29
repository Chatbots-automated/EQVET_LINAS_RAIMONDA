import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

// The tenant boundary in this project is the Supabase Auth user: every
// business row carries user_id = auth.uid() (see 20260916000002_auth_and_rls).
//
// TenantId is branded so server code can't accidentally pass a raw string
// from the browser (a client_id, an email, a form field...) where a tenant is
// expected — the only way to get one is requireTenant(), which reads it from
// the verified session.
export type TenantId = string & { readonly __brand: "TenantId" };

/** Verified tenant + a Supabase client acting AS that user (RLS applies). */
export interface TenantContext {
  tenantId: TenantId;
  supabase: SupabaseClient<Database>;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export async function requireTenant(): Promise<TenantContext> {
  const supabase = await createClient();
  // getUser() verifies the JWT with Supabase Auth (not just cookie presence).
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UnauthenticatedError();
  return { tenantId: data.user.id as TenantId, supabase: supabase as unknown as SupabaseClient<Database> };
}
