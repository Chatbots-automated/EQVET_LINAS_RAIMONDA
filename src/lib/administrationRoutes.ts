export type AdministrationRouteCode = "iv" | "im" | "sc" | "iu" | "imm" | "pos";

export interface AdministrationRoute {
  code: AdministrationRouteCode;
  label: string;
  fullLabel: string;
}

/** Administration routes affecting withdrawal (karencija) periods — mirrors Vaida's route system. */
export const ADMINISTRATION_ROUTES: AdministrationRoute[] = [
  { code: "iv", label: "i.v", fullLabel: "į veną (i.v)" },
  { code: "im", label: "i.m", fullLabel: "į raumenis (i.m)" },
  { code: "sc", label: "s.c", fullLabel: "po oda (s.c)" },
  { code: "iu", label: "i.u", fullLabel: "į gimdą (i.u)" },
  { code: "imm", label: "i.mm", fullLabel: "į spenį (i.mm)" },
  { code: "pos", label: "p.o.s", fullLabel: "per burną (p.o.s)" },
];

/**
 * Resolves the withdrawal (karencija) days for a product given the selected
 * administration route. Falls back to the product's default
 * withdrawal_days_meat/milk if the route-specific value isn't set.
 */
export function getRouteWithdrawalDays(
  product: Record<string, unknown> | null | undefined,
  route: string | null | undefined,
  type: "meat" | "milk"
): number | null {
  if (!product) return null;
  const fallback = (type === "meat" ? product.withdrawal_days_meat : product.withdrawal_days_milk) as
    | number
    | null
    | undefined;
  if (!route) return fallback ?? null;
  const routeSpecific = product[`withdrawal_${route}_${type}`] as number | null | undefined;
  return routeSpecific ?? fallback ?? null;
}

/** True if the product's category requires a withdrawal (karencija) period to be tracked. */
export function requiresWithdrawal(category: string | null | undefined): boolean {
  return category === "medicines";
}

export type WithdrawalFieldKey =
  | "withdrawal_iv_meat"
  | "withdrawal_iv_milk"
  | "withdrawal_im_meat"
  | "withdrawal_im_milk"
  | "withdrawal_sc_meat"
  | "withdrawal_sc_milk"
  | "withdrawal_iu_meat"
  | "withdrawal_iu_milk"
  | "withdrawal_imm_meat"
  | "withdrawal_imm_milk"
  | "withdrawal_pos_meat"
  | "withdrawal_pos_milk";

/** Empty string defaults for all 12 route-specific withdrawal form fields (seeds product create/edit forms). */
export const EMPTY_WITHDRAWAL_ROUTE_FIELDS: Record<WithdrawalFieldKey, string> = {
  withdrawal_iv_meat: "",
  withdrawal_iv_milk: "",
  withdrawal_im_meat: "",
  withdrawal_im_milk: "",
  withdrawal_sc_meat: "",
  withdrawal_sc_milk: "",
  withdrawal_iu_meat: "",
  withdrawal_iu_milk: "",
  withdrawal_imm_meat: "",
  withdrawal_imm_milk: "",
  withdrawal_pos_meat: "",
  withdrawal_pos_milk: "",
};

export function withdrawalFieldKey(code: AdministrationRouteCode, type: "meat" | "milk"): WithdrawalFieldKey {
  return `withdrawal_${code}_${type}` as WithdrawalFieldKey;
}

/** Builds the { withdrawal_iv_meat, ... } insert/update payload from a form's string values. */
export function parseWithdrawalRouteFields(
  values: Record<WithdrawalFieldKey, string>
): Record<WithdrawalFieldKey, number | null> {
  const result = {} as Record<WithdrawalFieldKey, number | null>;
  (Object.keys(EMPTY_WITHDRAWAL_ROUTE_FIELDS) as WithdrawalFieldKey[]).forEach((key) => {
    const raw = values[key];
    result[key] = raw ? parseInt(raw, 10) : null;
  });
  return result;
}

/** Reads the 12 route-specific withdrawal fields off a product-like record into string form values. */
export function productToWithdrawalRouteFields(
  product: Record<string, unknown> | null | undefined
): Record<WithdrawalFieldKey, string> {
  const result = { ...EMPTY_WITHDRAWAL_ROUTE_FIELDS };
  (Object.keys(EMPTY_WITHDRAWAL_ROUTE_FIELDS) as WithdrawalFieldKey[]).forEach((key) => {
    const value = product?.[key] as number | null | undefined;
    result[key] = value !== null && value !== undefined ? value.toString() : "";
  });
  return result;
}
