import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type Attachment = Database["public"]["Tables"]["visit_attachments"]["Row"];

/** Private storage bucket, see 20261016000001_visit_attachments.sql. */
const BUCKET = "visit-files";

/** Same limit as the bucket's file_size_limit. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What the file picker offers; the bucket enforces the same list server-side. */
export const ACCEPT_FILES =
  "image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv";

const SIGNED_URL_SECONDS = 60 * 60;

// Phone photos are 3–12 MB; the longest side is scaled down to this so a visit's
// photos stay a few hundred KB each (still sharp enough to read a label or a wound).
const MAX_IMAGE_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const COMPRESS_ABOVE_BYTES = 400 * 1024;

export const isImage = (mime: string | null | undefined) => !!mime && mime.startsWith("image/");

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shrinks big JPEG/PNG/WebP photos before upload. Anything it cannot decode
 * (HEIC outside Safari, GIF, documents) or that would not get smaller is
 * returned untouched.
 */
export async function prepareFile(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < COMPRESS_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? `.${m[1].toLowerCase()}` : "";
}

export interface UploadResult {
  uploaded: Attachment[];
  /** One message per file that failed, with the file name. */
  errors: string[];
}

/**
 * Uploads files to a visit: bytes to storage first, then the row. A failed row
 * insert removes the just-uploaded bytes again, so nothing is left dangling.
 * Storage keys are ASCII (uuid + extension) — the original name lives in file_name.
 */
export async function uploadVisitFiles(
  supabase: SupabaseClient<Database>,
  visitId: string,
  files: File[]
): Promise<UploadResult> {
  const result: UploadResult = { uploaded: [], errors: [] };
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    result.errors.push("Nepavyko nustatyti prisijungimo — prisijunkite iš naujo.");
    return result;
  }

  for (const original of files) {
    if (original.size > MAX_FILE_BYTES) {
      result.errors.push(`${original.name}: failas didesnis nei ${formatBytes(MAX_FILE_BYTES)}.`);
      continue;
    }
    const file = await prepareFile(original);
    const path = `${userId}/${visitId}/${crypto.randomUUID()}${extensionOf(file.name)}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) {
      result.errors.push(`${original.name}: ${uploadError.message}`);
      continue;
    }

    const { data, error: insertError } = await supabase
      .from("visit_attachments")
      .insert({
        visit_id: visitId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
      })
      .select()
      .single();
    if (insertError || !data) {
      await supabase.storage.from(BUCKET).remove([path]);
      result.errors.push(`${original.name}: ${insertError?.message ?? "nepavyko išsaugoti."}`);
      continue;
    }
    result.uploaded.push(data);
  }
  return result;
}

/** Removes the row, then its stored file. */
export async function deleteAttachment(supabase: SupabaseClient<Database>, attachment: Attachment): Promise<string | null> {
  const { error } = await supabase.from("visit_attachments").delete().eq("id", attachment.id);
  if (error) return error.message;
  await supabase.storage.from(BUCKET).remove([attachment.storage_path]);
  return null;
}

/** Stored files of the given paths, e.g. before the visit that owns them is deleted. */
export async function removeStoredFiles(supabase: SupabaseClient<Database>, paths: string[]) {
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
}

export async function loadVisitAttachments(supabase: SupabaseClient<Database>, visitId: string): Promise<Attachment[]> {
  const { data } = await supabase
    .from("visit_attachments")
    .select("*")
    .eq("visit_id", visitId)
    .order("created_at");
  return data ?? [];
}

/** Files of the given animals, newest first. */
export async function loadAnimalAttachments(supabase: SupabaseClient<Database>, animalIds: string[]): Promise<Attachment[]> {
  if (animalIds.length === 0) return [];
  const { data } = await supabase
    .from("visit_attachments")
    .select("*")
    .in("animal_id", animalIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** visit id → number of files, for the paperclip in the visit list. */
export async function loadAttachmentCounts(supabase: SupabaseClient<Database>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // PostgREST returns at most 1000 rows per request — page through all of them.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("visit_attachments")
      .select("visit_id")
      .order("id")
      .range(from, from + PAGE - 1);
    for (const row of data ?? []) counts.set(row.visit_id, (counts.get(row.visit_id) ?? 0) + 1);
    if (!data || data.length < PAGE) break;
  }
  return counts;
}

/** attachment id → short-lived URL to view / download the file. */
export async function signedUrls(supabase: SupabaseClient<Database>, attachments: Attachment[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (attachments.length === 0) return urls;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(
    attachments.map((a) => a.storage_path),
    SIGNED_URL_SECONDS
  );
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  for (const a of attachments) {
    const url = byPath.get(a.storage_path);
    if (url) urls.set(a.id, url);
  }
  return urls;
}
