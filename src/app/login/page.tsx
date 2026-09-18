"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PawPrint } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Neteisingas el. paštas arba slaptažodis.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-950 via-teal-900 to-emerald-900 px-4">
      <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-80 rounded-full bg-amber-400/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex size-14 items-center justify-center rounded-2xl bg-white/10 shadow-lg ring-1 ring-white/20">
            <PawPrint className="size-7 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">EQ VET</h1>
          <p className="mt-1 text-sm text-emerald-100/70">Veterinarinės apskaitos sistema</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white p-6 shadow-2xl"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              El. paštas
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Slaptažodis
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow-md transition-colors hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60"
          >
            {loading ? "Jungiamasi..." : "Prisijungti"}
          </button>
        </form>
      </div>
    </div>
  );
}
