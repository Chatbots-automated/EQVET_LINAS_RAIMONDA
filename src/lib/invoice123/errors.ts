// Normalized Invoice123 errors. Technical details stay server-side (logs);
// the browser only ever gets `userMessage`, in Lithuanian.

export type Invoice123ErrorCode =
  | "not_configured" // no token saved for this tenant
  | "disabled" // token saved but integration switched off
  | "misconfigured" // e.g. no default series/unit chosen
  | "unauthorized" // 401 — invalid/revoked token
  | "forbidden" // 403 — token lacks a permission
  | "not_found" // 404
  | "validation" // 422
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "network" // DNS/connection failure
  | "timeout"
  | "unexpected_response"; // non-JSON / unknown envelope

export class Invoice123Error extends Error {
  readonly code: Invoice123ErrorCode;
  readonly status: number | null;
  readonly userMessage: string;
  readonly validationErrors?: Record<string, string[]>;

  constructor(opts: {
    code: Invoice123ErrorCode;
    status?: number | null;
    message: string;
    userMessage?: string;
    validationErrors?: Record<string, string[]>;
    permission?: string;
  }) {
    super(opts.message);
    this.name = "Invoice123Error";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.validationErrors = opts.validationErrors;
    this.userMessage = opts.userMessage ?? defaultUserMessage(opts.code, opts.permission);
    if (!opts.userMessage && opts.validationErrors) {
      // Invoice123's own messages are already Lithuanian, e.g. "products.0.price: Lauko reikšmė turi būti skaičius."
      const details = Object.entries(opts.validationErrors)
        .slice(0, 3)
        .map(([field, msgs]) => `${field}: ${msgs[0]}`)
        .join("; ");
      if (details) this.userMessage += ` (${details})`;
    }
  }
}

function defaultUserMessage(code: Invoice123ErrorCode, permission?: string): string {
  switch (code) {
    case "not_configured":
      return "Sąskaita123 integracija nesukonfigūruota — įveskite API raktą nustatymuose.";
    case "disabled":
      return "Sąskaita123 integracija išjungta.";
    case "misconfigured":
      return "Sąskaita123 nustatymai nepilni — pasirinkite seriją ir vienetą.";
    case "unauthorized":
      return "API raktas neteisingas arba nebegalioja.";
    case "forbidden":
      return permission
        ? `Sąskaita123 API raktas neturi ${permission} teisės.`
        : "Sąskaita123 API raktas neturi reikalingų teisių.";
    case "not_found":
      return "Sąskaita123 įrašas nerastas.";
    case "validation":
      return "Sąskaita123 atmetė duomenis. Patikrinkite kliento arba sąskaitos duomenis.";
    case "rate_limited":
      return "Per daug užklausų į Sąskaita123. Pabandykite po minutės.";
    case "server_error":
      return "Sąskaita123 paslauga šiuo metu nepasiekiama. Pabandykite vėliau.";
    case "network":
    case "timeout":
      return "Nepavyko prisijungti prie Sąskaita123.";
    case "unexpected_response":
      return "Sąskaita123 grąžino netikėtą atsakymą.";
  }
}

export function codeForStatus(status: number): Invoice123ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unexpected_response";
}

/** For server actions: turn anything thrown into a safe, user-facing message. */
export function toUserMessage(err: unknown): string {
  if (err instanceof Invoice123Error) return err.userMessage;
  return "Įvyko netikėta klaida. Pabandykite dar kartą.";
}

/** Log-safe message for anything thrown (Supabase PostgrestError is a plain object in some versions). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  const e = err as { code?: string; message?: string } | null;
  return e?.message ? `${e.code ?? "error"}: ${e.message}` : String(err);
}
