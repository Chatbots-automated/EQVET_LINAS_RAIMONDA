"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  PawPrint,
  Package,
  PackagePlus,
  Boxes,
  Stethoscope,
  FileBarChart,
  Users,
  Droplet,
  Receipt,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/supabase/auth-context";
import { createClient } from "@/lib/supabase/client";
import { ThemeProvider, useTheme } from "@/lib/theme";

// Apskaita always stays gold/amber — it already complements every theme.
const APSKAITA_TONE = { active: "bg-amber-50 text-amber-800", dot: "bg-amber-500" };
// Everything that reads/writes the tenant's Invoice123 account lives in one section.
const INVOICE123_TONE = { active: "bg-sky-50 text-sky-800", dot: "bg-sky-500" };

const NAV_SECTIONS = [
  {
    label: "Veterinarija",
    themed: true,
    items: [
      { href: "/", label: "Pagrindinis", icon: LayoutDashboard },
      { href: "/animals", label: "Gyvūnai", icon: PawPrint },
      { href: "/visits", label: "Vizitai", icon: Stethoscope },
      { href: "/biocides", label: "Biocidai", icon: Droplet },
    ],
  },
  {
    label: "Apskaita",
    themed: false,
    tone: APSKAITA_TONE,
    items: [
      { href: "/inventory", label: "Atsargos", icon: Boxes },
      { href: "/products", label: "Produktai", icon: Package },
      { href: "/reports", label: "Ataskaitos", icon: FileBarChart },
    ],
  },
  {
    label: "Integruota su Sąskaita123",
    themed: false,
    tone: INVOICE123_TONE,
    items: [
      { href: "/clients", label: "Klientai", icon: Users },
      { href: "/sales-invoices", label: "Sąskaitos", icon: Receipt },
      { href: "/receiving", label: "Pajamavimas", icon: PackagePlus },
      { href: "/settings/invoice123", label: "Nustatymai", icon: Settings },
    ],
  },
];

function Brand({ logoUrl, size }: { logoUrl: string | null; size: "sm" | "lg" }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote logo, not worth next/image remotePatterns config for a sidebar mark
      <img
        src={logoUrl}
        alt="Logotipas"
        className={`w-auto object-contain ${size === "lg" ? "h-24 max-w-[230px]" : "h-11 max-w-[150px]"}`}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
        <PawPrint className="size-4 text-white" strokeWidth={2} />
      </div>
      <span className={`font-bold tracking-tight text-emerald-700 ${size === "lg" ? "text-xl" : "text-lg"}`}>
        EQ VET
      </span>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("logo_url, full_name, theme")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setLogoUrl(data?.logo_url ?? null);
        setFullName(data?.full_name || null);
        setTheme(data?.theme ?? null);
      });
  }, [user]);

  return (
    <ThemeProvider theme={theme}>
      <ShellContent logoUrl={logoUrl} fullName={fullName}>
        {children}
      </ShellContent>
    </ThemeProvider>
  );
}

function ShellContent({
  logoUrl,
  fullName,
  children,
}: {
  logoUrl: string | null;
  fullName: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();

  const displayName = fullName || user?.email || "";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm md:hidden">
        <Brand logoUrl={logoUrl} size="sm" />
        <button
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Meniu"
          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-64 shrink-0 transform border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="hidden items-center justify-center border-b border-slate-200 px-5 py-5 md:flex">
          <Brand logoUrl={logoUrl} size="lg" />
        </div>

        <nav className="mt-16 space-y-5 overflow-y-auto px-3 pb-3 md:mt-4 md:h-[calc(100vh-11.5rem)]">
          {NAV_SECTIONS.map((section) => {
            const tone = section.themed
              ? { active: theme.navVetActive, dot: theme.navVetDot }
              : section.tone ?? APSKAITA_TONE;
            return (
              <div key={section.label}>
                <div className="mb-1.5 flex items-center gap-2 px-3">
                  <span className={`size-1.5 rounded-full ${tone.dot}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {section.label}
                  </span>
                </div>
                <div className="space-y-1">
                  {section.items.map(({ href, label, icon: Icon }) => {
                    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          active ? tone.active : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        <Icon size={18} />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-1 py-1">
            <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${theme.avatarGradient}`}>
              {initial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-700">{fullName || "Vartotojas"}</p>
              <p className="truncate text-[11px] text-slate-400">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut size={18} />
            Atsijungti
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <main className="min-w-0 flex-1 bg-slate-50 px-4 pb-10 pt-20 md:px-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
