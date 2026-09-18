import { type ButtonHTMLAttributes, forwardRef } from "react";
import { useTheme } from "@/lib/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const STATIC_VARIANT_CLASSES: Record<Exclude<Variant, "primary">, string> = {
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ className = "", variant = "primary", size = "md", ...props }, ref) => {
  const theme = useTheme();
  const variantClasses = variant === "primary" ? `${theme.buttonPrimary} text-white` : STATIC_VARIANT_CLASSES[variant];
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variantClasses} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
});
Button.displayName = "Button";
