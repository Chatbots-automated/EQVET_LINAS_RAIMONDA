import "server-only";
import { errorMessage, toUserMessage } from "@/lib/invoice123/errors";
import { UnauthenticatedError } from "@/lib/tenant";

// Server Actions return values instead of throwing: in production Next.js
// replaces thrown error messages with a generic digest, and we never want raw
// technical errors (which could contain API details) reaching the browser.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function runAction<T>(op: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UnauthenticatedError) return { ok: false, error: "Sesija baigėsi — prisijunkite iš naujo." };
    console.error(JSON.stringify({ scope: "action", op, error: errorMessage(err) }));
    return { ok: false, error: toUserMessage(err) };
  }
}
