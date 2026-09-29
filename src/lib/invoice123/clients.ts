import "server-only";
import type { Database } from "@/lib/database.types";
import type { TenantContext } from "@/lib/tenant";
import { audit } from "./audit";
import { fetchAllPages, invoice123Request } from "./client";
import { loadInvoice123Config } from "./config";
import { errorMessage, Invoice123Error } from "./errors";
import type { Invoice123ClientCreatePayload, Invoice123ClientListItem, Invoice123Page } from "./types";

// GVET clients are per-tenant rows (clients.user_id), so the Invoice123
// client id lives directly on the row: external_source = 'invoice123',
// external_id = <Invoice123 client id>. Each tenant's ids point into that
// tenant's own Invoice123 account only.
//
// Invoice123 has no client update endpoint, so we only ever link or create.

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
const SOURCE = "invoice123";

export interface ClientCandidate {
  id: string;
  name: string;
  code: string | null;
  vatCode: string | null;
  address: string | null;
  matchedBy: "code" | "name";
}

export type ClientLinkState =
  | { state: "linked"; invoice123ClientId: string }
  | { state: "unlinked"; candidates: ClientCandidate[] };

/** Invoice123 uses "-" / "" to mean "no code". */
function cleanCode(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t && t !== "-" ? t : null;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("lt");

async function loadClient(ctx: TenantContext, clientId: string): Promise<ClientRow> {
  // RLS: returns nothing for another tenant's client.
  const { data, error } = await ctx.supabase.from("clients").select("*").eq("id", clientId).eq("user_id", ctx.tenantId).maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Invoice123Error({ code: "not_found", message: `Client ${clientId} not found for tenant`, userMessage: "Klientas nerastas." });
  }
  return data;
}

// ---- import (Invoice123 → GVET) -------------------------------------------------

export interface ClientSyncResult {
  inserted: number;
  updated: number;
  linked: number;
  /** Deleted in Invoice123 and had no animals/invoices → deleted here too. */
  removed: string[];
  /** Deleted in Invoice123 but has animals/invoices here → kept, link cleared. */
  unlinked: string[];
}

/**
 * Mirrors THIS tenant's Invoice123 client list into GVET. Replaces the n8n
 * sync_invoice123_clients RPC. Repeatable:
 *   - linked rows are updated only when something actually changed
 *   - unlinked GVET companies with the same company code get linked, not duplicated
 *   - new Invoice123 clients are inserted
 *   - linked clients that no longer exist in Invoice123 (deleted there) are
 *     deleted here too — unless they have animals or invoices, in which case
 *     they are kept and only unlinked, so no veterinary history is lost
 * Phone/email/notes (app-only) are never touched.
 */
export async function importClients(ctx: TenantContext): Promise<ClientSyncResult> {
  const remote = await fetchAllPages<Invoice123ClientListItem>(ctx.tenantId, "/clients", {
    permission: "client:index",
    requireEnabled: false,
    op: "import-clients",
  });

  const { data: local, error } = await ctx.supabase.from("clients").select("*").eq("user_id", ctx.tenantId);
  if (error) throw error;

  const byExternalId = new Map<string, ClientRow>();
  const unlinkedByCode = new Map<string, ClientRow[]>();
  for (const c of local ?? []) {
    if (c.external_source === SOURCE && c.external_id) byExternalId.set(c.external_id, c);
    else if (c.company_code) {
      const k = c.company_code.trim();
      unlinkedByCode.set(k, [...(unlinkedByCode.get(k) ?? []), c]);
    }
  }

  const result: ClientSyncResult = { inserted: 0, updated: 0, linked: 0, removed: [], unlinked: [] };
  const now = new Date().toISOString();
  const remoteIds = new Set(remote.map((r) => r.id));

  for (const r of remote) {
    const code = cleanCode(r.code);
    const vat = cleanCode(r.vat_code);
    const fields = {
      name: r.name.trim(),
      address: r.address?.trim() || null,
      country_code: r.country_code?.trim().toUpperCase() || null,
      is_company: code !== null || vat !== null,
      company_code: code,
      vat_code: vat,
    };

    const existing = byExternalId.get(r.id);
    if (existing) {
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => existing[k] !== fields[k]);
      if (!changed) continue;
      const { error: e } = await ctx.supabase.from("clients").update({ ...fields, synced_at: now }).eq("id", existing.id).eq("user_id", ctx.tenantId);
      if (e) throw e;
      result.updated++;
      continue;
    }

    const sameCode = code ? unlinkedByCode.get(code) : undefined;
    if (sameCode?.length === 1) {
      const target = sameCode[0];
      const { error: e } = await ctx.supabase
        .from("clients")
        .update({ external_source: SOURCE, external_id: r.id, synced_at: now, vat_code: target.vat_code ?? vat, country_code: target.country_code ?? fields.country_code })
        .eq("id", target.id)
        .eq("user_id", ctx.tenantId);
      if (e) throw e;
      unlinkedByCode.delete(code!);
      result.linked++;
      continue;
    }

    const { error: e } = await ctx.supabase
      .from("clients")
      .insert({ ...fields, synced_at: now, user_id: ctx.tenantId, external_source: SOURCE, external_id: r.id });
    if (e) throw e;
    result.inserted++;
  }

  // ---- clients deleted in Invoice123 ----
  const gone = [...byExternalId.values()].filter((c) => !remoteIds.has(c.external_id!));
  // Safety: an empty remote list is far more likely an API/account problem
  // than "every client was deleted" — never mass-delete on that.
  if (gone.length > 0 && remote.length > 0) {
    for (const c of gone) {
      if (!(await confirmedDeletedInInvoice123(ctx, c))) continue;

      const [{ count: animals }, { count: invoices }] = await Promise.all([
        ctx.supabase.from("animals").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("user_id", ctx.tenantId),
        ctx.supabase.from("sales_invoices").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("user_id", ctx.tenantId),
      ]);

      if ((animals ?? 0) === 0 && (invoices ?? 0) === 0) {
        const { error: e } = await ctx.supabase.from("clients").delete().eq("id", c.id).eq("user_id", ctx.tenantId);
        if (e) throw e;
        result.removed.push(c.name);
      } else {
        const { error: e } = await ctx.supabase
          .from("clients")
          .update({ external_source: null, external_id: null, synced_at: null })
          .eq("id", c.id)
          .eq("user_id", ctx.tenantId);
        if (e) throw e;
        result.unlinked.push(c.name);
      }
    }
  }

  await audit(ctx.tenantId, {
    action: "clients_imported",
    result: "ok",
    details: { remote: remote.length, inserted: result.inserted, updated: result.updated, linked: result.linked, removed: result.removed.length, unlinked: result.unlinked.length },
  });
  return result;
}

/** Second, targeted check before deleting: the id must be absent from a name/code search too. */
async function confirmedDeletedInInvoice123(ctx: TenantContext, c: ClientRow): Promise<boolean> {
  const query: Record<string, string> = cleanCode(c.company_code) ? { code: cleanCode(c.company_code)! } : { name: c.name.trim() };
  const page = await invoice123Request<Invoice123Page<Invoice123ClientListItem>>(ctx.tenantId, "/clients", {
    query: { ...query, limit: 50 },
    permission: "client:index",
    requireEnabled: false,
    op: "confirm-client-deleted",
  });
  return !page.result.some((r) => r.id === c.external_id);
}

// ---- link state / candidates ----------------------------------------------------

export async function getClientLinkState(ctx: TenantContext, clientId: string): Promise<ClientLinkState> {
  const client = await loadClient(ctx, clientId);
  if (client.external_source === SOURCE && client.external_id) {
    return { state: "linked", invoice123ClientId: client.external_id };
  }
  return { state: "unlinked", candidates: await findCandidates(ctx, client) };
}

async function findCandidates(ctx: TenantContext, client: ClientRow): Promise<ClientCandidate[]> {
  const list = (query: Record<string, string>) =>
    invoice123Request<Invoice123Page<Invoice123ClientListItem>>(ctx.tenantId, "/clients", {
      query: { ...query, limit: 50 },
      permission: "client:index",
      requireEnabled: false,
      op: "find-client",
    }).then((p) => p.result);

  const out = new Map<string, ClientCandidate>();
  const code = cleanCode(client.company_code);
  if (code) {
    for (const r of await list({ code })) {
      if (cleanCode(r.code) === code) out.set(r.id, toCandidate(r, "code"));
    }
  }
  // Name matches are only ever SUGGESTED — two different people can share a
  // name, so the user must confirm; we never auto-merge on name.
  for (const r of await list({ name: client.name.trim() })) {
    if (!out.has(r.id) && normName(r.name) === normName(client.name)) out.set(r.id, toCandidate(r, "name"));
  }

  // Don't offer Invoice123 clients already linked to another GVET client.
  const ids = [...out.keys()];
  if (ids.length) {
    const { data } = await ctx.supabase
      .from("clients")
      .select("external_id")
      .eq("user_id", ctx.tenantId)
      .eq("external_source", SOURCE)
      .in("external_id", ids);
    for (const row of data ?? []) if (row.external_id) out.delete(row.external_id);
  }
  return [...out.values()];
}

function toCandidate(r: Invoice123ClientListItem, matchedBy: "code" | "name"): ClientCandidate {
  return { id: r.id, name: r.name, code: cleanCode(r.code), vatCode: cleanCode(r.vat_code), address: r.address, matchedBy };
}

// ---- link / create ----------------------------------------------------------------

/** Links a GVET client to an EXISTING Invoice123 client chosen by the user. */
export async function linkClient(ctx: TenantContext, clientId: string, invoice123ClientId: string): Promise<ClientLinkState> {
  const client = await loadClient(ctx, clientId);
  if (client.external_source === SOURCE && client.external_id) {
    return { state: "linked", invoice123ClientId: client.external_id };
  }

  // The id comes from the browser: accept it only if it is one of the
  // candidates found in THIS tenant's Invoice123 account.
  const candidates = await findCandidates(ctx, client);
  if (!candidates.some((c) => c.id === invoice123ClientId)) {
    throw new Invoice123Error({ code: "not_found", message: `Invoice123 client ${invoice123ClientId} not a candidate`, userMessage: "Pasirinktas Sąskaita123 klientas nerastas." });
  }

  await saveLink(ctx, client.id, invoice123ClientId);
  await audit(ctx.tenantId, { action: "client_linked", result: "ok", entityType: "client", entityId: client.id, details: { invoice123ClientId } });
  return { state: "linked", invoice123ClientId };
}

/** Creates the client in Invoice123 and stores the returned id. */
export async function createClientInInvoice123(ctx: TenantContext, clientId: string): Promise<ClientLinkState> {
  const client = await loadClient(ctx, clientId);
  if (client.external_source === SOURCE && client.external_id) {
    return { state: "linked", invoice123ClientId: client.external_id };
  }
  const { settings } = await loadInvoice123Config(ctx.tenantId);

  const code = cleanCode(client.company_code);
  const vat = cleanCode(client.vat_code);
  const payload: Invoice123ClientCreatePayload = {
    name: client.name.trim(),
    code,
    client_code: null,
    type: "client",
    code_type: client.is_company ? "company" : "personal",
    phone: client.phone?.trim() || null,
    address: client.address?.trim() || null,
    delivery_address: null,
    note: "Sukurta per EQ VET",
    email: client.email?.trim() || null,
    vat_enabled: vat !== null,
    vat_code: vat,
    country_code: client.country_code?.trim().toUpperCase() || settings?.default_country_code || "LT",
    use_client_pay_term: false,
    pay_term: settings?.default_payment_term_days ?? 30,
  };

  let createdId: string;
  try {
    const created = await invoice123Request<{ id?: string } | null>(ctx.tenantId, "/clients", {
      method: "POST",
      body: payload,
      permission: "client:store",
      requireEnabled: false,
      op: "create-client",
    });
    if (!created?.id) {
      throw new Invoice123Error({ code: "unexpected_response", message: "POST /clients returned no id" });
    }
    createdId = created.id;
  } catch (err) {
    // Ambiguous outcome (timeout / 5xx / no id): the client may exist now.
    // Reconcile by exact name (+code) before anyone retries.
    if (err instanceof Invoice123Error && ["timeout", "network", "server_error", "unexpected_response"].includes(err.code)) {
      const recovered = (await findCandidates(ctx, client)).filter((c) => (code ? c.code === code : c.matchedBy === "name"));
      if (recovered.length === 1) {
        await saveLink(ctx, client.id, recovered[0].id);
        await audit(ctx.tenantId, { action: "client_linked", result: "ok", entityType: "client", entityId: client.id, details: { invoice123ClientId: recovered[0].id, reconciled: true } });
        return { state: "linked", invoice123ClientId: recovered[0].id };
      }
    }
    await audit(ctx.tenantId, { action: "client_created_invoice123", result: "error", entityType: "client", entityId: client.id, details: { error: errorMessage(err) } });
    throw err;
  }

  await saveLink(ctx, client.id, createdId);
  await audit(ctx.tenantId, { action: "client_created_invoice123", result: "ok", entityType: "client", entityId: client.id, details: { invoice123ClientId: createdId } });
  return { state: "linked", invoice123ClientId: createdId };
}

/**
 * Pushes a GVET client to Invoice123 right after it's saved:
 *   already linked                      → nothing to do
 *   exactly one exact company-code match → link to it
 *   same-name matches (no code match)   → return them; the user decides
 *                                         (two people can share a name)
 *   no match                            → create in Invoice123
 * Tenants without a token yet are skipped silently.
 */
export async function pushClient(ctx: TenantContext, clientId: string): Promise<ClientLinkState | { state: "not_configured" }> {
  const client = await loadClient(ctx, clientId);
  if (client.external_source === SOURCE && client.external_id) {
    return { state: "linked", invoice123ClientId: client.external_id };
  }
  try {
    await loadInvoice123Config(ctx.tenantId);
  } catch (err) {
    if (err instanceof Invoice123Error && err.code === "not_configured") return { state: "not_configured" };
    throw err;
  }

  const candidates = await findCandidates(ctx, client);
  const byCode = candidates.filter((c) => c.matchedBy === "code");
  if (byCode.length === 1) return linkClient(ctx, client.id, byCode[0].id);
  if (candidates.length > 0) return { state: "unlinked", candidates };
  return createClientInInvoice123(ctx, client.id);
}

async function saveLink(ctx: TenantContext, clientId: string, invoice123ClientId: string) {
  const { error } = await ctx.supabase
    .from("clients")
    .update({ external_source: SOURCE, external_id: invoice123ClientId, synced_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("user_id", ctx.tenantId);
  if (error) {
    if (error.code === "23505") {
      throw new Invoice123Error({ code: "validation", message: "Invoice123 client already linked", userMessage: "Šis Sąskaita123 klientas jau susietas su kitu EQ VET klientu." });
    }
    throw error;
  }
}
