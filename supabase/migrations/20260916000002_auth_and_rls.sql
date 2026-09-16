-- ============================================================================
-- EQ VET — Row Level Security: per-user tenant isolation
--
-- Two independent vets share this Supabase project. Every business table has
-- a user_id column (default auth.uid()); RLS enforces that a session can only
-- ever see/write its own rows. There are no roles — each account is a full
-- admin of its own data and has zero visibility into the other's.
--
-- Run this AFTER 20260916000001_init_schema.sql.
-- ============================================================================

-- ============================================================================
-- 1. profiles — a user may only see/update their own profile row
-- ============================================================================

alter table "public"."profiles" enable row level security;

drop policy if exists "profiles_select_own" on "public"."profiles";
create policy "profiles_select_own" on "public"."profiles"
  for select using (id = auth.uid());

drop policy if exists "profiles_update_own" on "public"."profiles";
create policy "profiles_update_own" on "public"."profiles"
  for update using (id = auth.uid()) with check (id = auth.uid());

-- No insert/delete policy: rows are created only by handle_new_user()
-- (SECURITY DEFINER, bypasses RLS) and removed only via the auth.users cascade.

-- ============================================================================
-- 2. Per-user tenant tables — standard owner-only policy on all four verbs
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'suppliers', 'products', 'invoices', 'invoice_items', 'batches',
    'animals', 'visits', 'usage_items'
  ])
  loop
    execute format('alter table "public".%I enable row level security', t);

    execute format('drop policy if exists "%1$s_select_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_select_own" on "public".%1$I for select using (user_id = auth.uid())',
      t
    );

    execute format('drop policy if exists "%1$s_insert_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_insert_own" on "public".%1$I for insert with check (user_id = auth.uid())',
      t
    );

    execute format('drop policy if exists "%1$s_update_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_update_own" on "public".%1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );

    execute format('drop policy if exists "%1$s_delete_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_delete_own" on "public".%1$I for delete using (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- 3. Views respect the querying user's own RLS, not the view owner's
-- ============================================================================

alter view "public"."stock_by_batch" set (security_invoker = true);
alter view "public"."stock_by_product" set (security_invoker = true);
alter view "public"."stock_movements" set (security_invoker = true);
alter view "public"."visit_history_view" set (security_invoker = true);

-- ============================================================================
-- 4. Grants — anon gets nothing; authenticated gets table/view access gated
-- by the RLS policies above; service_role (server-only, never in the
-- browser) keeps full access for admin/provisioning tasks.
-- ============================================================================

do $$
declare
  obj text;
begin
  for obj in select unnest(array[
    'profiles', 'suppliers', 'products', 'invoices', 'invoice_items', 'batches',
    'animals', 'visits', 'usage_items',
    'stock_by_batch', 'stock_by_product', 'stock_movements', 'visit_history_view'
  ])
  loop
    execute format('revoke all on table "public".%I from anon', obj);
    execute format('grant select, insert, update, delete on table "public".%I to authenticated', obj);
    execute format('grant all on table "public".%I to service_role', obj);
  end loop;
end $$;

revoke execute on all functions in schema "public" from anon;
grant execute on all functions in schema "public" to authenticated, service_role;

-- ============================================================================
-- NOTE — provisioning the two accounts
-- ============================================================================
-- Auth accounts must be created through Supabase Auth (Dashboard →
-- Authentication → Add user, "Auto Confirm User" checked), not raw SQL.
-- profiles rows are created automatically by handle_new_user() the moment
-- each account is created — nothing else to run afterwards.
--
-- Before creating the two accounts, also turn OFF "Allow new users to sign
-- up" in Dashboard → Authentication → Settings, so nobody else can self-
-- register into this project.
