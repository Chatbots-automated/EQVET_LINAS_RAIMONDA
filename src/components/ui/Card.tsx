export function Card({
  title,
  actions,
  className = "",
  children,
}: {
  title?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
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
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClasses = {
    default: "text-slate-900",
    warning: "text-amber-600",
    danger: "text-red-600",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={`mt-2 text-2xl font-bold ${toneClasses}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
