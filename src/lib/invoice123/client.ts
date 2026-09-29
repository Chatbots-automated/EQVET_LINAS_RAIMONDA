import "server-only";
import type { TenantId } from "@/lib/tenant";
import { assertReadyForInvoicing, loadInvoice123Config } from "./config";
import { codeForStatus, Invoice123Error } from "./errors";
import type { Invoice123Envelope, Invoice123Page } from "./types";

// The ONE place that talks HTTP to Invoice123. Every tenant goes through the
// same code; the only per-tenant input is the token + settings loaded by
// loadInvoice123Config(tenantId).

const BASE_URL = "https://app.invoice123.com/api/v1.0";
const TIMEOUT_MS = 20_000;
const MAX_GET_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
export const MAX_PAGE_SIZE = 50;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Invoice123 permission this call needs (e.g. "client:index") — named in the 403 message. */
  permission?: string;
  /** Short label for logs, e.g. "sync-config". */
  op?: string;
  accept?: string;
}

interface LogContext {
  tenantId?: TenantId;
}

/**
 * Sends one request with retries/timeout/logging and returns the raw
 * successful Response. Non-2xx responses become Invoice123Error.
 *
 * Only GETs are retried. POSTs (invoices, clients, payments) are never
 * retried here — a timeout may mean the object WAS created, and blindly
 * retrying would duplicate it. Callers must reconcile instead.
 */
async function send(token: string, endpoint: string, opts: RequestOptions, ctx: LogContext): Promise<Response> {
  const method = opts.method ?? "GET";
  const url = new URL(BASE_URL + (endpoint.startsWith("/") ? endpoint : `/${endpoint}`));
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    Accept: opts.accept ?? "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const maxAttempts = method === "GET" ? MAX_GET_RETRIES + 1 : 1;

  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      log(ctx, { op: opts.op, method, path: url.pathname, status: null, ms: Date.now() - started, attempt, error: isTimeout ? "timeout" : "network" });
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Invoice123Error({
        code: isTimeout ? "timeout" : "network",
        message: `${method} ${url.pathname} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    log(ctx, { op: opts.op, method, path: url.pathname, status: res.status, ms: Date.now() - started, attempt });

    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
      await sleep(retryAfterMs(res) ?? backoffMs(attempt));
      continue;
    }

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as Invoice123Envelope<unknown> | null;
      throw new Invoice123Error({
        code: codeForStatus(res.status),
        status: res.status,
        message: `${method} ${url.pathname} → ${res.status}: ${json?.error?.message ?? "no error body"}`,
        validationErrors: json?.error?.errors,
        permission: opts.permission,
      });
    }
    return res;
  }
}

/**
 * Low-level JSON call with an explicit token. Prefer invoice123Request();
 * this is exported so a freshly pasted token can be tested before it's saved.
 */
export async function callInvoice123<T>(
  token: string,
  endpoint: string,
  opts: RequestOptions = {},
  ctx: LogContext = {}
): Promise<T> {
  const res = await send(token, endpoint, opts, ctx);
  const json = (await res.json().catch(() => null)) as Invoice123Envelope<T> | null;
  if (!json || !("data" in json)) {
    throw new Invoice123Error({
      code: "unexpected_response",
      status: res.status,
      message: `${opts.method ?? "GET"} ${endpoint} → ${res.status}: response is not a { data } envelope`,
    });
  }
  return json.data;
}

/**
 * Tenant-scoped request: loads THIS tenant's token + settings and calls
 * Invoice123 with them. By default the integration must be enabled with
 * series/unit chosen; pass requireEnabled: false for setup operations
 * (connection test, configuration sync) that run before that.
 */
export async function invoice123Request<T>(
  tenantId: TenantId,
  endpoint: string,
  opts: RequestOptions & { requireEnabled?: boolean } = {}
): Promise<T> {
  const { settings, token } = await loadInvoice123Config(tenantId);
  if (opts.requireEnabled !== false) assertReadyForInvoicing(settings);
  return callInvoice123<T>(token, endpoint, opts, { tenantId });
}

/** Tenant-scoped binary GET (e.g. invoice PDFs). */
export async function invoice123Binary(
  tenantId: TenantId,
  endpoint: string,
  opts: Omit<RequestOptions, "method" | "body"> & { requireEnabled?: boolean } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  const { settings, token } = await loadInvoice123Config(tenantId);
  if (opts.requireEnabled !== false) assertReadyForInvoicing(settings);
  // Invoice123 answers 400 unless Accept is application/json — even for the PDF endpoint.
  const res = await send(token, endpoint, opts, { tenantId });
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") };
}

/** Walks every page of a list endpoint (limit=50, the API maximum). */
export async function fetchAllPages<T>(
  tenantId: TenantId,
  endpoint: string,
  opts: Omit<RequestOptions, "method" | "body"> & { requireEnabled?: boolean } = {}
): Promise<T[]> {
  const { settings, token } = await loadInvoice123Config(tenantId);
  if (opts.requireEnabled !== false) assertReadyForInvoicing(settings);

  const all: T[] = [];
  for (let page = 1; ; page++) {
    const data = await callInvoice123<Invoice123Page<T>>(
      token,
      endpoint,
      { ...opts, query: { ...opts.query, limit: MAX_PAGE_SIZE, page } },
      { tenantId }
    );
    all.push(...data.result);
    if (data.pagination.current_page >= data.pagination.last_page) return all;
  }
}

// ---- helpers -----------------------------------------------------------------

// Safe identifiers only: never the token, headers, query string (can carry
// personal codes) or bodies.
function log(ctx: LogContext, entry: Record<string, unknown>) {
  const line = JSON.stringify({ scope: "invoice123", tenant: ctx.tenantId, ...entry });
  if (entry.error || (typeof entry.status === "number" && entry.status >= 400)) console.warn(line);
  else console.info(line);
}

function backoffMs(attempt: number) {
  return 1000 * 2 ** (attempt - 1);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(seconds, 10) * 1000 : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
