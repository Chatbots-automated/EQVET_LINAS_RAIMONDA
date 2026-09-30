"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenant, UnauthenticatedError } from "@/lib/tenant";

const MIN_LENGTH = 10;
const MAX_LENGTH = 72; // bcrypt ignores everything after 72 bytes
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Same rules as shown next to the form; enforced here because the browser can't be trusted. */
function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_LENGTH) return `Slaptažodis turi būti bent ${MIN_LENGTH} simbolių.`;
  if (new TextEncoder().encode(password).length > MAX_LENGTH) return `Slaptažodis per ilgas (daugiausia ${MAX_LENGTH} simboliai).`;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "Slaptažodyje turi būti bent viena raidė ir bent vienas skaičius.";
  if (/^(.)\1+$/.test(password)) return "Slaptažodis per paprastas.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Slaptažodyje negali būti jūsų el. pašto.";
  return null;
}

/**
 * Change the signed-in user's own password.
 *  - who: only ever the user of the verified session — no user id comes from the browser
 *  - proof: the current password is re-checked against Supabase Auth, so a
 *    borrowed open session alone is not enough to take the account over
 *  - throttle: 5 wrong current passwords in 15 minutes lock the form
 *  - afterwards every OTHER session of the account is signed out
 * Passwords are never logged or stored by this code.
 */
export async function changePasswordAction(input: { currentPassword: string; newPassword: string }): Promise<ActionResult<null>> {
  try {
    const ctx = await requireTenant();
    const currentPassword = String(input?.currentPassword ?? "");
    const newPassword = String(input?.newPassword ?? "");

    const { data: userData } = await ctx.supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) return fail("Sesija baigėsi — prisijunkite iš naujo.");

    const problem = passwordProblem(newPassword, email);
    if (problem) return fail(problem);
    if (newPassword === currentPassword) return fail("Naujas slaptažodis turi skirtis nuo dabartinio.");

    const admin = createAdminClient();
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error: countError } = await admin
      .from("password_change_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.tenantId)
      .eq("succeeded", false)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_FAILURES) {
      return fail(`Per daug nesėkmingų bandymų. Pabandykite po ${WINDOW_MINUTES} minučių.`);
    }

    // Re-authenticate with a throwaway client so this check never touches the user's session cookies.
    const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({ email, password: currentPassword });
    if (signInError || signIn.user?.id !== ctx.tenantId) {
      await admin.from("password_change_attempts").insert({ user_id: ctx.tenantId, succeeded: false });
      return fail("Dabartinis slaptažodis neteisingas.");
    }
    await verifier.auth.signOut({ scope: "local" });

    const { error: updateError } = await admin.auth.admin.updateUserById(ctx.tenantId, { password: newPassword });
    if (updateError) {
      // Supabase's own rules (e.g. leaked-password protection, minimum length) can still refuse it.
      console.error(JSON.stringify({ scope: "action", op: "account.change-password", error: updateError.message }));
      return fail("Supabase atmetė šį slaptažodį — pasirinkite kitą, stipresnį.");
    }

    await admin.from("password_change_attempts").insert({ user_id: ctx.tenantId, succeeded: true });
    // Anyone else still logged in to this account (another browser, a lost phone) is signed out.
    await ctx.supabase.auth.signOut({ scope: "others" });
    return { ok: true, data: null };
  } catch (err) {
    if (err instanceof UnauthenticatedError) return fail("Sesija baigėsi — prisijunkite iš naujo.");
    console.error(JSON.stringify({ scope: "action", op: "account.change-password", error: err instanceof Error ? err.message : String(err) }));
    return fail("Įvyko netikėta klaida. Pabandykite dar kartą.");
  }
}
