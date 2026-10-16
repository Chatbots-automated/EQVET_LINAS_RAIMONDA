"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, isImage, signedUrls, type Attachment } from "@/lib/attachments";

/**
 * Thumbnails (photos) and file tiles (PDFs, documents) of attachments. Photos open
 * in a full-size viewer, other files in a new tab. URLs are short-lived signed URLs.
 */
export function FileGrid({
  attachments,
  caption,
  onDelete,
}: {
  attachments: Attachment[];
  /** Extra line under the file name, e.g. the visit date and animal. */
  caption?: (a: Attachment) => React.ReactNode;
  onDelete?: (a: Attachment) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);

  const key = attachments.map((a) => a.id).join(",");
  useEffect(() => {
    let cancelled = false;
    signedUrls(supabase, attachments).then((m) => {
      if (!cancelled) setUrls(m);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supabase]);

  const photos = attachments.filter((a) => isImage(a.mime_type) && urls.has(a.id) && !broken.has(a.id));
  const viewIndex = viewing ? photos.findIndex((a) => a.id === viewing) : -1;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {attachments.map((a) => {
          const url = urls.get(a.id);
          const showThumb = isImage(a.mime_type) && url && !broken.has(a.id);
          const preview = showThumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not an optimizable static asset
            <img
              src={url}
              alt={a.file_name}
              loading="lazy"
              onError={() => setBroken((b) => new Set(b).add(a.id))}
              className="h-28 w-full object-cover"
            />
          ) : (
            <div className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400">
              <FileText size={28} />
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {a.file_name.split(".").pop()?.slice(0, 5) || "failas"}
              </span>
            </div>
          );
          return (
            <li key={a.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              {showThumb ? (
                <button type="button" onClick={() => setViewing(a.id)} className="block w-full" title="Peržiūrėti">
                  {preview}
                </button>
              ) : url ? (
                <a href={url} target="_blank" rel="noreferrer" className="block" title="Atidaryti">
                  {preview}
                </a>
              ) : (
                preview
              )}
              <div className="px-2.5 py-2 text-xs">
                <div className="truncate font-medium text-slate-800" title={a.file_name}>
                  {a.file_name}
                </div>
                {caption && <div className="truncate text-slate-500">{caption(a)}</div>}
                <div className="text-slate-400">{formatBytes(a.size_bytes)}</div>
              </div>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(a)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-slate-500 shadow-sm hover:bg-red-50 hover:text-red-600"
                  aria-label="Ištrinti failą"
                  title="Ištrinti"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {viewIndex >= 0 && (
        <Viewer
          photo={photos[viewIndex]}
          url={urls.get(photos[viewIndex].id)!}
          onClose={() => setViewing(null)}
          onPrev={viewIndex > 0 ? () => setViewing(photos[viewIndex - 1].id) : undefined}
          onNext={viewIndex < photos.length - 1 ? () => setViewing(photos[viewIndex + 1].id) : undefined}
        />
      )}
    </>
  );
}

function Viewer({
  photo,
  url,
  onClose,
  onPrev,
  onNext,
}: {
  photo: Attachment;
  url: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  useEffect(() => {
    // Capture phase + stopPropagation: Escape / arrows must not also close the modal underneath.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
      else return;
      e.stopPropagation();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
          aria-label="Atidaryti naujame lange"
          title="Atidaryti naujame lange"
        >
          <ExternalLink size={18} />
        </a>
        <button onClick={onClose} className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25" aria-label="Uždaryti">
          <X size={18} />
        </button>
      </div>
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
          aria-label="Ankstesnė"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
          aria-label="Kita"
        >
          <ChevronRight size={22} />
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
      <img
        src={url}
        alt={photo.file_name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
