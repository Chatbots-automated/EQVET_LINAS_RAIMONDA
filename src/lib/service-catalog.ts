import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type CatalogService = Pick<Database["public"]["Tables"]["service_catalog"]["Row"], "id" | "name" | "price">;

export async function loadServiceCatalog(supabase: SupabaseClient<Database>): Promise<CatalogService[]> {
  const { data } = await supabase.from("service_catalog").select("id, name, price").order("name");
  return data ?? [];
}

export function findCatalogService(catalog: CatalogService[], title: string) {
  const t = title.trim().toLowerCase();
  return t ? catalog.find((c) => c.name.toLowerCase() === t) : undefined;
}

/**
 * Remembers services (and their latest price) in the tenant's list, so they
 * show up in the "Paslauga" dropdown next time. A service without a price is
 * added to the list but never wipes a price that is already saved.
 */
export async function rememberServices(
  supabase: SupabaseClient<Database>,
  catalog: CatalogService[],
  services: { title: string; price: number | null }[]
) {
  const byName = new Map<string, { name: string; price: number | null }>();
  for (const s of services) {
    const title = s.title.trim();
    if (!title) continue;
    // Reuse the saved spelling so "gydymas" and "Gydymas" stay one entry.
    const name = findCatalogService(catalog, title)?.name ?? title;
    byName.set(name.toLowerCase(), { name, price: s.price });
  }
  const rows = [...byName.values()];
  const priced = rows.filter((r) => r.price !== null);
  const unpriced = rows.filter((r) => r.price === null);
  if (priced.length) await supabase.from("service_catalog").upsert(priced, { onConflict: "user_id,name" });
  if (unpriced.length) {
    await supabase.from("service_catalog").upsert(unpriced, { onConflict: "user_id,name", ignoreDuplicates: true });
  }
}
