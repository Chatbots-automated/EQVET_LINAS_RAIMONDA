import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useTheme } from "@/lib/theme";

function Wrapper({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className ?? ""}`}>
      {label}
      {required && <span className="text-red-500"> *</span>}
      {children}
    </label>
  );
}

export function Input({
  label,
  required,
  wrapperClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; wrapperClassName?: string }) {
  const theme = useTheme();
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <input
        required={required}
        className={`mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:bg-white focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${theme.fieldFocus}`}
        {...props}
      />
    </Wrapper>
  );
}

export function Select({
  label,
  required,
  wrapperClassName,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; wrapperClassName?: string }) {
  const theme = useTheme();
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <select
        required={required}
        className={`mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:bg-white focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${theme.fieldFocus}`}
        {...props}
      >
        {children}
      </select>
    </Wrapper>
  );
}

export function Textarea({
  label,
  required,
  wrapperClassName,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; wrapperClassName?: string }) {
  const theme = useTheme();
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <textarea
        required={required}
        className={`mt-1 min-h-20 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:bg-white focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${theme.fieldFocus}`}
        {...props}
      />
    </Wrapper>
  );
}
