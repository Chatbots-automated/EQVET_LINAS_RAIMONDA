import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const baseClasses =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400";

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
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <input required={required} className={baseClasses} {...props} />
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
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <select required={required} className={baseClasses} {...props}>
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
  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <textarea required={required} className={`${baseClasses} min-h-20`} {...props} />
    </Wrapper>
  );
}
