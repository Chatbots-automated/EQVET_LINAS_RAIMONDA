-- ============================================================================
-- EQ VET — admin access across both tenants
--
-- Adds a single "sees everything" admin flag on profiles. Everyone else
-- stays strictly isolated to their own user_id rows (see 20260916000002).
-- An admin account can additionally see/manage every farm's data — intended
-- for the operator (Gratas), not for either vet's day-to-day account.
--
-- Run this AFTER 20260916000001_init_schema.sql and 20260916000002_auth_and_rls.sql.
-- ============================================================================

alter table "public"."profiles"
  add column if not exists "is_admin" boolean not null default false;

create or replace function "public"."is_admin"()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

comment on function "public"."is_admin"() is 'True if the calling user''s profile has is_admin set. Used to grant cross-tenant read/write in RLS policies below.';

-- ---- profiles: admin can see every profile, not just their own ----------

drop policy if exists "profiles_select_own" on "public"."profiles";
create policy "profiles_select_own" on "public"."profiles"
  for select using (id = auth.uid() or public.is_admin());

-- ---- per-tenant tables: admin bypasses the user_id check on every verb --

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'suppliers', 'products', 'invoices', 'invoice_items', 'batches',
    'animals', 'visits', 'usage_items'
  ])
  loop
    execute format('drop policy if exists "%1$s_select_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_select_own" on "public".%1$I for select using (user_id = auth.uid() or public.is_admin())',
      t
    );

    execute format('drop policy if exists "%1$s_insert_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_insert_own" on "public".%1$I for insert with check (user_id = auth.uid() or public.is_admin())',
      t
    );

    execute format('drop policy if exists "%1$s_update_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_update_own" on "public".%1$I for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin())',
      t
    );

    execute format('drop policy if exists "%1$s_delete_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_delete_own" on "public".%1$I for delete using (user_id = auth.uid() or public.is_admin())',
      t
    );
  end loop;
end $$;

-- Views already run with security_invoker = true (see 20260916000002), so
-- they automatically inherit the widened policies above for an admin caller
-- — no view changes needed.
