"use client";

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { AttachButtons } from "./AttachButtons";
import { MAX_FILE_BYTES, formatBytes, isImage } from "@/lib/attachments";

/**
 * Files picked in the "Naujas vizitas" form. The visit does not exist yet, so they are
 * only held here; the page uploads them right after the visit is saved.
 */
export function StagedFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [previews, setPreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    const urls = files.map((f) => (isImage(f.type) ? URL.createObjectURL(f) : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          Nuotraukos ir failai{files.length > 0 && <span className="ml-1.5 font-normal text-slate-500">({files.length})</span>}
        </span>
        <AttachButtons onFiles={(picked) => onChange([...files, ...picked])} />
      </div>
      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                <img src={previews[i]!} alt={f.name} className="h-20 w-full object-cover" />
              ) : (
                <div className="flex h-20 items-center justify-center bg-slate-50 text-slate-400">
                  <FileText size={24} />
                </div>
              )}
              <div className="px-2 py-1.5 text-xs">
                <div className="truncate font-medium text-slate-800" title={f.name}>
                  {f.name}
                </div>
                <div className={f.size > MAX_FILE_BYTES ? "text-red-600" : "text-slate-400"}>
                  {f.size > MAX_FILE_BYTES ? `Per didelis (> ${formatBytes(MAX_FILE_BYTES)})` : formatBytes(f.size)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-slate-500 shadow-sm hover:bg-red-50 hover:text-red-600"
                aria-label="Pašalinti"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
