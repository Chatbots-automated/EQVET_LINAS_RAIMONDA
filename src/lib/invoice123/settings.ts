import "server-only";
import type { TenantContext, TenantId } from "@/lib/tenant";
import { callInvoice123, invoice123Request } from "./client";
import { getTokenHint, loadInvoice123Config, saveToken, deleteToken, type Invoice123Settings } from "./config";
import { Invoice123Error } from "./errors";
import type {
  Invoice123Activity,
  Invoice123Bank,
  Invoice123CashRegister,
  Invoice123ClientListItem,
  Invoice123Company,
  Invoice123Expense,
  Invoice123ExpenseTypeOption,
  Invoice123Page,
  Invoice123RemoteOptions,
  Invoice123Series,
  Invoice123Unit,
  Invoice123Vat,
} from "./types";

export const SUPPORTED_LANGUAGES = ["lt", "en"] as const;

export interface Invoice123Status {
  hasToken: boolean;
  tokenHint: string | null;
  settings: Invoice123Settings | null;
}

export interface SaveDefaultsInput {
  enabled: boolean;
  seriesId: string | null;
  unitId: string | null;
  bankId: string | null;
  activityId: string | null;
  vatId: string | null;
  expenseTypeId: string | null;
  language: string;
  paymentTermDays: number;
  issuedBy: string;
}

// ---- reads ---------------------------------------------------------------------

export async function getStatus(ctx: TenantContext): Promise<Invoice123Status> {
  // settings via the user's own session (RLS); token hint via service_role.
  const [{ data: settings, error }, tokenHint] = await Promise.all([
    ctx.supabase.from("invoice123_settings").select("*").eq("user_id", ctx.tenantId).maybeSingle(),
    getTokenHint(ctx.tenantId),
  ]);
  if (error) throw error;
  return { hasToken: tokenHint !== null, tokenHint, settings };
}

// ---- token -----------------------------------------------------------------------

/**
 * Validates a pasted token against Invoice123 BEFORE storing it (a 401 never
 * gets saved), then stores it encrypted and immediately syncs the tenant's
 * configuration so the defaults dropdowns are populated.
 */
export async function connect(ctx: TenantContext, rawToken: string): Promise<Invoice123Status> {
  const token = rawToken.trim();
  if (token.length < 20 || /\s/.test(token)) {
    throw new Invoice123Error({ code: "unauthorized", message: "Token failed local format check" });
  }

  // /series needs no special permission; a bad token → 401 → Invoice123Error.
  await callInvoice123<Invoice123Series[]>(token, "/series", { op: "connect" }, { tenantId: ctx.tenantId });

  await saveToken(ctx.tenantId, token);
  await syncConfiguration(ctx);
  return getStatus(ctx);
}

export async function disconnect(ctx: TenantContext): Promise<void> {
  await deleteToken(ctx.tenantId);
  const { error } = await ctx.supabase
    .from("invoice123_settings")
    .update({ enabled: false })
    .eq("user_id", ctx.tenantId);
  if (error) throw error;
}

// ---- connection test -----------------------------------------------------------

export async function testConnection(ctx: TenantContext): Promise<{ clientCount: number }> {
  try {
    const page = await invoice123Request<Invoice123Page<Invoice123ClientListItem>>(ctx.tenantId, "/clients", {
      query: { limit: 1 },
      permission: "client:index",
      requireEnabled: false,
      op: "test-connection",
    });
    await ctx.supabase
      .from("invoice123_settings")
      .update({ last_connection_ok_at: new Date().toISOString(), last_error: null })
      .eq("user_id", ctx.tenantId);
    return { clientCount: page.pagination.total };
  } catch (err) {
    if (err instanceof Invoice123Error) {
      await ctx.supabase.from("invoice123_settings").update({ last_error: err.userMessage }).eq("user_id", ctx.tenantId);
    }
    throw err;
  }
}

// ---- configuration sync --------------------------------------------------------

/**
 * Pulls the tenant's option lists (series, units, VATs, banks, activities,
 * cash registers, company VAT status) and caches them in
 * invoice123_settings.remote_options, so invoice creation never re-fetches
 * them (rate limit: 60 req/min on the standard plan).
 *
 * Series and units are required for invoicing, so failing to read them fails
 * the sync. Everything else is optional and listed in `unavailable`.
 * Previously chosen defaults that no longer exist in Invoice123 are cleared,
 * which also switches the integration off until a new choice is saved.
 */
export async function syncConfiguration(ctx: TenantContext): Promise<Invoice123Settings> {
  const { token } = await loadInvoice123Config(ctx.tenantId);
  const options = await fetchRemoteOptions(token, ctx.tenantId);

  const { data: existing, error: readError } = await ctx.supabase
    .from("invoice123_settings")
    .select("*")
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (readError) throw readError;

  const keep = <T extends { id: string }>(id: string | null | undefined, list: T[]) =>
    id && list.some((x) => x.id === id) ? id : null;

  const seriesId = keep(existing?.default_series_id, options.series);
  const unitId = keep(existing?.default_unit_id, options.units);

  const patch = {
    user_id: ctx.tenantId,
    remote_options: options,
    company_vat_enabled: options.company?.vat_enabled ?? null,
    company_vat_status: options.company?.vat_status ?? null,
    last_config_sync_at: new Date().toISOString(),
    last_connection_ok_at: new Date().toISOString(),
    last_error: null,
    default_series_id: seriesId,
    default_series_title: seriesId ? existing?.default_series_title ?? null : null,
    default_unit_id: unitId,
    default_unit_name: unitId ? existing?.default_unit_name ?? null : null,
    default_bank_id: keep(existing?.default_bank_id, options.banks),
    default_bank_name: keep(existing?.default_bank_id, options.banks) ? existing?.default_bank_name ?? null : null,
    default_activity_id: keep(existing?.default_activity_id, options.activities),
    default_activity_name: keep(existing?.default_activity_id, options.activities)
      ? existing?.default_activity_name ?? null
      : null,
    default_vat_id: keep(existing?.default_vat_id, options.vats),
    // Expense types only come from past expenses, so a type missing from the
    // latest 50 is not proof it was deleted — keep the saved one.
    default_expense_type_id: existing?.default_expense_type_id ?? null,
    enabled: Boolean(existing?.enabled && seriesId && unitId),
  };

  const { data, error } = await ctx.supabase
    .from("invoice123_settings")
    .upsert(patch, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function fetchRemoteOptions(token: string, tenantId: TenantId): Promise<Invoice123RemoteOptions> {
  const get = <T>(path: string) => callInvoice123<T>(token, path, { op: "sync-config" }, { tenantId });

  // Required — let failures propagate.
  const [series, units] = await Promise.all([get<Invoice123Series[]>("/series"), get<Invoice123Unit[]>("/units")]);

  const unavailable: string[] = [];
  const optional = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return await get<T>(path);
    } catch (err) {
      if (!(err instanceof Invoice123Error)) throw err;
      unavailable.push(path.slice(1).split("?")[0]);
      return fallback;
    }
  };

  const [vats, banks, activities, cashRegisters, company, recentExpenses] = await Promise.all([
    optional<Invoice123Vat[]>("/vats", []),
    optional<Invoice123Bank[]>("/banks", []),
    optional<Invoice123Activity[]>("/activities", []),
    optional<Invoice123CashRegister[]>("/cash-registers", []),
    optional<Invoice123Company | null>("/company", null),
    optional<Invoice123Page<Invoice123Expense> | null>("/expenses?limit=50", null),
  ]);

  return {
    series, units, vats, banks, activities, cash_registers: cashRegisters, company,
    expense_types: expenseTypesFrom(recentExpenses?.result ?? []),
    unavailable,
  };
}

function expenseTypesFrom(expenses: Invoice123Expense[]): Invoice123ExpenseTypeOption[] {
  const byId = new Map<string, Invoice123ExpenseTypeOption>();
  for (const e of expenses) {
    for (const p of e.products ?? []) {
      if (!p.expense_type_id) continue;
      const cur = byId.get(p.expense_type_id);
      if (cur) cur.uses++;
      else byId.set(p.expense_type_id, { id: p.expense_type_id, example: p.title, uses: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => b.uses - a.uses);
}

// ---- defaults --------------------------------------------------------------------

/**
 * Saves the tenant's invoice defaults. Every chosen ID is checked against the
 * options cached by the last sync — the browser can only pick values that
 * really exist in THIS tenant's Invoice123 account.
 */
export async function saveDefaults(ctx: TenantContext, input: SaveDefaultsInput): Promise<Invoice123Settings> {
  const { data: current, error: readError } = await ctx.supabase
    .from("invoice123_settings")
    .select("*")
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (readError) throw readError;

  const options = current?.remote_options;
  if (!current || !options) {
    throw new Invoice123Error({ code: "misconfigured", message: "Save defaults before config sync", userMessage: "Pirmiausia sinchronizuokite nustatymus su Sąskaita123." });
  }

  const pick = <T extends { id: string }>(id: string | null, list: T[], label: string): T | null => {
    if (!id) return null;
    const found = list.find((x) => x.id === id);
    if (!found) {
      throw new Invoice123Error({
        code: "misconfigured",
        message: `Unknown ${label} id ${id}`,
        userMessage: `Pasirinkta reikšmė (${label}) nebeegzistuoja Sąskaita123. Sinchronizuokite nustatymus iš naujo.`,
      });
    }
    return found;
  };

  const series = pick(input.seriesId, options.series, "serija");
  const unit = pick(input.unitId, options.units, "vienetas");
  const bank = pick(input.bankId, options.banks, "bankas");
  const activity = pick(input.activityId, options.activities, "veikla");
  const vat = pick(input.vatId, options.vats, "PVM");
  const expenseTypeOptions = options.expense_types ?? [];
  const expenseType =
    input.expenseTypeId && input.expenseTypeId === current.default_expense_type_id
      ? { id: current.default_expense_type_id, example: current.default_expense_type_name ?? "" }
      : pick(input.expenseTypeId, expenseTypeOptions, "išlaidų tipas");

  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(input.language)) {
    throw new Invoice123Error({ code: "misconfigured", message: `Bad language ${input.language}`, userMessage: "Nepalaikoma kalba." });
  }
  const term = Math.trunc(input.paymentTermDays);
  if (!Number.isFinite(term) || term < 0 || term > 365) {
    throw new Invoice123Error({ code: "misconfigured", message: `Bad term ${input.paymentTermDays}`, userMessage: "Mokėjimo terminas turi būti nuo 0 iki 365 dienų." });
  }
  if (input.enabled && (!series || !unit)) {
    throw new Invoice123Error({ code: "misconfigured", message: "Enable without series/unit" });
  }

  const { data, error } = await ctx.supabase
    .from("invoice123_settings")
    .update({
      enabled: input.enabled,
      default_series_id: series?.id ?? null,
      default_series_title: series?.title ?? null,
      default_unit_id: unit?.id ?? null,
      default_unit_name: unit?.name ?? null,
      default_bank_id: bank?.id ?? null,
      default_bank_name: bank ? `${bank.title} ${bank.account}` : null,
      default_activity_id: activity?.id ?? null,
      default_activity_name: activity ? activity.name ?? activity.title ?? activity.id : null,
      default_vat_id: vat?.id ?? null,
      default_expense_type_id: expenseType?.id ?? null,
      default_expense_type_name: expenseType?.example ?? null,
      default_language: input.language,
      default_payment_term_days: term,
      issued_by: input.issuedBy.trim().slice(0, 120) || null,
    })
    .eq("user_id", ctx.tenantId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
