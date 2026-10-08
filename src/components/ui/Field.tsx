"use client";

import { Fragment, useEffect, useId, useRef, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Calendar, Search, X } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { dateTextToISO, isoToDateText } from "@/lib/format";

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

// ---- Dates -------------------------------------------------------------------
// Native <input type="date"> shows whatever format the browser locale dictates,
// so dates are typed as text in DD/MM/YYYY (slashes are inserted while typing)
// with a calendar button that opens the native picker. `value` / `onChange`
// always speak ISO "YYYY-MM-DD", exactly like a native date input.

interface DateFieldProps {
  value: string;
  /** ISO date, or "" while the text is empty / not yet a complete valid date. */
  onChange: (iso: string) => void;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
}

function maskDateText(raw: string) {
  // A pasted ISO date.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  // Typed with separators ("1/2/2026", "30.09.2026"): pad single-digit day / month.
  if (/[/.-]/.test(raw)) {
    const parts = raw.split(/[/.-]/).slice(0, 3).map((p) => p.replace(/\D/g, ""));
    if (parts.every((p, i) => p.length <= (i === 2 ? 4 : 2))) {
      return parts.map((p, i) => (i < parts.length - 1 && p.length === 1 ? `0${p}` : p)).join("/");
    }
  }

  // Digits only: slashes are inserted automatically.
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/");
}

export function DateField({ value, onChange, required, disabled, min, max, className, ...rest }: DateFieldProps) {
  const [text, setText] = useState(() => isoToDateText(value));
  const [prevValue, setPrevValue] = useState(value);
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Follow outside changes of `value`, but never overwrite what is being typed.
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== dateTextToISO(text)) setText(isoToDateText(value));
  }

  const iso = dateTextToISO(text);
  const problem =
    text && !iso
      ? "Įveskite datą formatu DD/MM/YYYY"
      : iso && min && iso < min
        ? `Data negali būti ankstesnė nei ${isoToDateText(min)}`
        : iso && max && iso > max
          ? `Data negali būti vėlesnė nei ${isoToDateText(max)}`
          : "";

  useEffect(() => {
    textRef.current?.setCustomValidity(problem);
  }, [problem]);

  function handleText(raw: string) {
    // Let backspace remove a trailing slash instead of re-inserting it.
    const next = raw.length < text.length ? raw.replace(/[^\d/]/g, "") : maskDateText(raw);
    setText(next);
    onChange(dateTextToISO(next));
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <span className="relative block">
      <input
        ref={textRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        required={required}
        disabled={disabled}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onBlur={() => {
          // An unfinished date snaps back to the last valid one, if there is one.
          if (text && !iso && value) setText(isoToDateText(value));
        }}
        className={`${className ?? ""} pr-8`}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openPicker}
        aria-label="Atidaryti kalendorių"
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-slate-400 hover:text-slate-600 disabled:pointer-events-none"
      >
        <Calendar size={15} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        min={min}
        max={max}
        value={iso}
        onChange={(e) => {
          setText(isoToDateText(e.target.value));
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 size-0 opacity-0"
      />
    </span>
  );
}

export function DateInput({
  label,
  wrapperClassName,
  ...props
}: Omit<DateFieldProps, "className"> & { label: string; wrapperClassName?: string }) {
  const theme = useTheme();
  return (
    <Wrapper label={label} required={props.required} className={wrapperClassName}>
      <DateField
        aria-label={label}
        className={`mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none transition-colors focus:bg-white focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${theme.fieldFocus}`}
        {...props}
      />
    </Wrapper>
  );
}

// ---- Searchable select ---------------------------------------------------------
// A <select> you can type into: the list narrows as you type (accents and
// case are ignored, every typed word must match somewhere in the option).

export interface SearchOption {
  value: string;
  label: string;
  /** Extra text shown smaller and also searched (e.g. the animal's owner). */
  hint?: string;
  /** Options sharing a group are listed under a header; pass them already ordered by group. */
  group?: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SearchSelect({
  label,
  options,
  value,
  onChange,
  required,
  disabled,
  placeholder = "Ieškoti...",
  wrapperClassName,
}: {
  label: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  wrapperClassName?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = words.length
    ? options.filter((o) => {
        const text = fold(`${o.label} ${o.hint ?? ""}`);
        return words.every((w) => text.includes(w));
      })
    : options;

  const problem = required && !value ? "Pasirinkite iš sąrašo" : "";
  useEffect(() => {
    inputRef.current?.setCustomValidity(problem);
  }, [problem]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(option: SearchOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.max(0, Math.min(matches.length - 1, a + step)));
    } else if (e.key === "Enter" && open) {
      e.preventDefault(); // never submit the form while choosing
      if (matches[active]) pick(matches[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <Wrapper label={label} required={required} className={wrapperClassName}>
      <span className="relative block">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : selected?.label ?? ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onKeyDown={onKeyDown}
          className={`mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 pr-8 text-sm font-normal text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${theme.fieldFocus}`}
        />
        {value && !disabled && !required ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Išvalyti"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
            className="absolute right-0 top-1 flex h-[calc(100%-0.25rem)] w-8 items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        ) : (
          <Search size={14} className="pointer-events-none absolute right-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-slate-400" />
        )}
        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            // Keep focus in the input while clicking / scrolling the list.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm font-normal shadow-lg"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-slate-500">Nieko nerasta</li>
            ) : (
              matches.map((o, i) => (
                <Fragment key={o.value}>
                  {o.group && o.group !== matches[i - 1]?.group && (
                    <li role="presentation" className="sticky top-0 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {o.group}
                    </li>
                  )}
                  <li
                    role="option"
                    data-idx={i}
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-slate-100" : ""} ${o.value === value ? "font-medium text-slate-900" : "text-slate-700"}`}
                  >
                    {o.label}
                    {o.hint && <span className="ml-2 text-xs text-slate-500">{o.hint}</span>}
                  </li>
                </Fragment>
              ))
            )}
          </ul>
        )}
      </span>
    </Wrapper>
  );
}
