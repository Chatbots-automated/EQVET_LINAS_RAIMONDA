"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachment, type Attachment } from "@/lib/attachments";
import { animalLabel, formatDate } from "@/lib/format";
import { FileGrid } from "./FileGrid";

interface VisitInfo {
  visit_id: string;
  visit_date: string;
  animal_tag: string | null;
  animal_name: string | null;
}

/**
 * Files of several visits at once (a client's animals, or one animal), newest visit
 * first. Each file says which visit and animal it belongs to and links to that visit.
 */
export function AttachmentGallery({
  attachments,
  visits,
  onChanged,
}: {
  attachments: Attachment[];
  visits: VisitInfo[];
  /** Called after a file was deleted so the page can reload its list. */
  onChanged?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState<string | null>(null);
  const byVisit = useMemo(() => new Map(visits.map((v) => [v.visit_id, v])), [visits]);

  const sorted = useMemo(
    () =>
      [...attachments].sort((a, b) => {
        const da = byVisit.get(a.visit_id)?.visit_date ?? "";
        const db = byVisit.get(b.visit_id)?.visit_date ?? "";
        return db.localeCompare(da) || b.created_at.localeCompare(a.created_at);
      }),
    [attachments, byVisit]
  );

  async function handleDelete(a: Attachment) {
    if (!confirm(`Ištrinti failą „${a.file_name}“?`)) return;
    const failure = await deleteAttachment(supabase, a);
    if (failure) setError(`Nepavyko ištrinti: ${failure}`);
    else onChanged?.();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <FileGrid
        attachments={sorted}
        onDelete={handleDelete}
        caption={(a) => {
          const v = byVisit.get(a.visit_id);
          if (!v) return null;
          return (
            <Link href={`/visits?visit=${v.visit_id}`} className="text-emerald-700 hover:underline" title="Atidaryti vizitą">
              {formatDate(v.visit_date)} · {animalLabel(v.animal_tag, v.animal_name)}
            </Link>
          );
        }}
      />
    </div>
  );
}
