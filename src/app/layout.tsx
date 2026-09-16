import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/supabase/auth-context";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "EQ VET",
  description: "Eq Vet, MB — veterinarinės apskaitos sistema",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lt" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
