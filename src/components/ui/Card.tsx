import { useTheme } from "@/lib/theme";

export function Card({
  title,
  titleIcon,
  actions,
  className = "",
  children,
}: {
  title?: string;
  titleIcon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          {title && (
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {titleIcon}
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "emerald",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "emerald" | "teal" | "amber" | "rose" | "brand";
}) {
  const theme = useTheme();
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600",
    teal: "bg-teal-50 text-teal-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    brand: theme.statBrand,
  }[tone];

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {icon && (
          <span className={`flex size-9 items-center justify-center rounded-lg ${toneClasses}`}>{icon}</span>
        )}
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
