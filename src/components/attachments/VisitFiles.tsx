"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachment, loadVisitAttachments, uploadVisitFiles, type Attachment } from "@/lib/attachments";
import { AttachButtons } from "./AttachButtons";
import { FileGrid } from "./FileGrid";

/** The files of one existing visit: see, add (camera / file) and delete. Saves immediately. */
export function VisitFiles({ visitId, onChanged }: { visitId: string; onChanged?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    loadVisitAttachments(supabase, visitId).then((rows) => {
      if (cancelled) return;
      setItems(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, visitId]);

  async function handleFiles(files: File[]) {
    setUploading(true);
    setError(null);
    const { uploaded, errors } = await uploadVisitFiles(supabase, visitId, files);
    setItems((prev) => [...prev, ...uploaded]);
    if (errors.length > 0) setError(errors.join(" "));
    setUploading(false);
    if (uploaded.length > 0) onChanged?.();
  }

  async function handleDelete(a: Attachment) {
    if (!confirm(`Ištrinti failą „${a.file_name}“?`)) return;
    const failure = await deleteAttachment(supabase, a);
    if (failure) {
      setError(`Nepavyko ištrinti: ${failure}`);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    onChanged?.();
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">
          Nuotraukos ir failai{items.length > 0 && <span className="ml-1.5 font-normal text-slate-500">({items.length})</span>}
        </h4>
        <AttachButtons onFiles={handleFiles} disabled={uploading} />
      </div>
      {uploading && <p className="mb-2 text-xs text-slate-500">Keliama...</p>}
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Kraunama...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Failų dar nėra — nufotografuokite arba pridėkite PDF.</p>
      ) : (
        <FileGrid attachments={items} onDelete={handleDelete} />
      )}
    </div>
  );
}
