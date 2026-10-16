"use client";

import { useRef } from "react";
import { Camera, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ACCEPT_FILES } from "@/lib/attachments";

/**
 * "Nufotografuoti" (opens the phone camera; a plain file picker on a computer) and
 * "Pridėti failą" (photos, PDFs, documents — several at once).
 */
export function AttachButtons({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // lets the same file be picked again
    if (files.length > 0) onFiles(files);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={fileRef} type="file" accept={ACCEPT_FILES} multiple className="hidden" onChange={pick} />
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => cameraRef.current?.click()}>
        <Camera size={14} /> Nufotografuoti
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
        <Paperclip size={14} /> Pridėti failą
      </Button>
    </div>
  );
}
