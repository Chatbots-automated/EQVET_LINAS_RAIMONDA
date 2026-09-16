"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  PawPrint,
  Package,
  PackagePlus,
  Boxes,
  Stethoscope,
  FileBarChart,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/supabase/auth-context";

const NAV_SECTIONS = [
  {
    label: "Veterinarija",
    items: [
      { href: "/", label: "Pagrindinis", icon: LayoutDashboard },
      { href: "/clients", label: "Klientai", icon: Users },
      { href: "/animals", label: "Gyvūnai", icon: PawPrint },
      { href: "/visits", label: "Vizitai", icon: Stethoscope },
    ],
  },
  {
    label: "Apskaita",
    items: [
      { href: "/receiving", label: "Pajamavimas", icon: PackagePlus },
      { href: "/inventory", label: "Atsargos", icon: Boxes },
      { href: "/products", label: "Produktai", icon: Package },
      { href: "/reports", label: "Ataskaitos", icon: FileBarChart },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <span className="text-lg font-bold text-emerald-700">EQ VET</span>
        <button onClick={() => setMobileOpen((v) => !v)} aria-label="Meniu">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-64 shrink-0 transform border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="hidden h-16 items-center px-6 md:flex">
          <span className="text-xl font-bold tracking-tight text-emerald-700">EQ VET</span>
        </div>

        <nav className="mt-16 space-y-5 px-3 md:mt-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {section.label}
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
                        active
                          ? "bg-emerald-50 text-emerald-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon size={18} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 p-3">
          <div className="mb-2 truncate px-3 text-xs text-slate-500">{user?.email}</div>
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
