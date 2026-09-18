"use client";

import { createContext, useContext } from "react";

export type ThemeName = "default" | "equine";

export interface ThemePreset {
  /** Nav "Veterinarija" section — active link + accent dot. */
  navVetActive: string;
  navVetDot: string;
  /** Primary button background + hover (Button's "primary" variant). */
  buttonPrimary: string;
  /** Icon-badge tone for the "brand" StatCard (e.g. Aktyvūs gyvūnai). */
  statBrand: string;
  /** Sidebar user-avatar circle gradient. */
  avatarGradient: string;
  /** Focus ring/border for form fields (Input/Select/Textarea). */
  fieldFocus: string;
  /** Login-adjacent accents that read fine even pre-auth aren't themed —
   * this only ever applies inside the authenticated shell. */
  linkText: string;
}

// "equine" is sampled from Linas's own EQVET logo (deep navy + warm gold) —
// applied only to his account. Every other account uses "default".
export const THEME_PRESETS: Record<ThemeName, ThemePreset> = {
  default: {
    navVetActive: "bg-teal-50 text-teal-800",
    navVetDot: "bg-teal-500",
    buttonPrimary: "bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300",
    statBrand: "bg-teal-50 text-teal-600",
    avatarGradient: "bg-gradient-to-br from-emerald-600 to-teal-700",
    fieldFocus: "focus:border-emerald-500 focus:ring-emerald-500/25",
    linkText: "text-emerald-700",
  },
  equine: {
    navVetActive: "bg-blue-50 text-blue-900",
    navVetDot: "bg-blue-900",
    buttonPrimary: "bg-blue-900 hover:bg-blue-950 disabled:bg-blue-300",
    statBrand: "bg-blue-50 text-blue-900",
    avatarGradient: "bg-gradient-to-br from-blue-900 to-amber-500",
    fieldFocus: "focus:border-blue-800 focus:ring-blue-800/25",
    linkText: "text-blue-800",
  },
};

const ThemeContext = createContext<ThemePreset>(THEME_PRESETS.default);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: string | null | undefined;
  children: React.ReactNode;
}) {
  const preset = THEME_PRESETS[(theme as ThemeName) ?? "default"] ?? THEME_PRESETS.default;
  return <ThemeContext.Provider value={preset}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
