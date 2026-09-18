"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  icon,
  iconClassName = "bg-emerald-50 text-emerald-600",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  icon?: React.ReactNode;
  iconClassName?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10 sm:pt-16">
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            {icon && (
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
                {icon}
              </span>
            )}
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Uždaryti"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
