import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for per-tenant Invoice123 API tokens at rest. The key lives only
// in the server environment, so a leaked DB dump alone doesn't reveal tokens.
//
// Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.INVOICE123_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("INVOICE123_TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("INVOICE123_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unrecognized token ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** "••••abcd" — the only form of the token that ever leaves the server. */
export function tokenHint(plain: string): string {
  return plain.slice(-4);
}
