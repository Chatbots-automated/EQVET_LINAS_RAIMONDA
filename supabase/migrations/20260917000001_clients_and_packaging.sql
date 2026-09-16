-- ============================================================================
-- EQ VET — clients (savininkai), batch packaging fields
--
-- - Adds "clients" (savininkai/ūkiai), the counterpart of Vaida's Client
--   concept: an animal now belongs to a client instead of carrying free-text
--   owner_name/owner_address/owner_phone.
-- - Adds package_size/package_count-driven receiving to batches (already on
--   products as package_size — "pakuotės dydis"; batches gets package_count
--   — "kiek pakuočių" — so received_qty can be package_size * package_count).
--
-- Run this AFTER 20260916000001, 20260916000002 and 20260916000003.
-- ============================================================================

-- ---- clients --------------------------------------------------------------

create table if not exists "public"."clients" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "name" text not null,
  "address" text,
  "phone" text,
  "email" text,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

create index if not exists "idx_clients_user_id" on "public"."clients" ("user_id");

drop trigger if exists "trg_clients_updated_at" on "public"."clients";
create trigger "trg_clients_updated_at" before update on "public"."clients"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."clients" enable row level security;

drop policy if exists "clients_select_own" on "public"."clients";
create policy "clients_select_own" on "public"."clients"
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "clients_insert_own" on "public"."clients";
create policy "clients_insert_own" on "public"."clients"
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "clients_update_own" on "public"."clients";
create policy "clients_update_own" on "public"."clients"
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "clients_delete_own" on "public"."clients";
create policy "clients_delete_own" on "public"."clients"
  for delete using (user_id = auth.uid() or public.is_admin());

revoke all on table "public"."clients" from anon;
grant select, insert, update, delete on table "public"."clients" to authenticated;
grant all on table "public"."clients" to service_role;

-- ---- drop the old view FIRST — it references animals.owner_name, which is
-- dropped below. Recreated at the end of this file against the new columns.

drop view if exists "public"."visit_history_view";

-- ---- animals: replace free-text owner_* with a client_id link -------------

alter table "public"."animals" add column if not exists "client_id" uuid references "public"."clients"("id") on delete set null;
create index if not exists "idx_animals_client_id" on "public"."animals" ("client_id");

alter table "public"."animals" drop column if exists "owner_name";
alter table "public"."animals" drop column if exists "owner_address";
alter table "public"."animals" drop column if exists "owner_phone";

-- ---- batches: package_size/package_count-driven receiving -----------------

alter table "public"."batches" add column if not exists "package_count" numeric(10, 2);

comment on column "public"."batches"."package_count" is 'Number of packages received ("kiek pakuočių"). Combined with products.package_size ("pakuotės dydis") to compute received_qty.';

-- ---- visit_history_view: surface client instead of owner_name -------------

create view "public"."visit_history_view" as
select
  v.id as visit_id,
  v.user_id,
  v.visit_date,
  v.reason,
  v.diagnosis,
  v.services,
  v.service_price,
  v.vet_name,
  v.notes,
  v.withdrawal_until_meat,
  v.withdrawal_until_milk,
  v.created_at,
  a.id as animal_id,
  a.tag_no as animal_tag,
  a.name as animal_name,
  a.species,
  c.id as client_id,
  c.name as client_name,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_name', p.name,
      'quantity', ui.qty,
      'unit', ui.unit,
      'batch_lot', b.lot
    )), '[]'::jsonb)
    from public.usage_items ui
    join public.products p on p.id = ui.product_id
    left join public.batches b on b.id = ui.batch_id
    where ui.visit_id = v.id
  ) as products_used
from public.visits v
left join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id
order by v.visit_date desc, v.created_at desc;

alter view "public"."visit_history_view" set (security_invoker = true);

grant select on table "public"."visit_history_view" to authenticated;
grant all on table "public"."visit_history_view" to service_role;
