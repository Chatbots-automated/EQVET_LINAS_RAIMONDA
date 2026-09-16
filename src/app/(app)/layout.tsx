import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

// proxy.ts already redirects unauthenticated visitors, but that's an
// optimistic cookie-presence check. This confirms the session server-side
// before rendering anything — real access control still lives in RLS.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  return <Shell>{children}</Shell>;
}
