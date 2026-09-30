-- ============================================================================
-- EQ VET — paslaugų sąrašas + kelių vizitų sąskaitos
--
-- 1. service_catalog — the vet's own list of services with a default price.
--    It feeds the "Paslauga" dropdown in the visit form, in "Vizito
--    užbaigimas" and in the invoice draft; new services typed there are
--    saved back to the list.
-- 2. sales_invoice_visits — which visits an invoice covers. One invoice can
--    now cover several visits of the same client (sales_invoices.visit_id
--    keeps pointing at the first one for older code). Same security model as
--    the other sales_* tables: tenants SELECT only, writes server-side.
--
-- Run this AFTER 20260930000001_visit_pricing.sql.
-- ============================================================================

-- ---- 1. service_catalog ------------------------------------------------------

create table if not exists "public"."service_catalog" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "name" text not null check (length(trim("name")) > 0),
  "price" numeric(12, 2) check ("price" >= 0),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "service_catalog_user_name_key" unique ("user_id", "name")
);

comment on table "public"."service_catalog" is 'Per-tenant list of services with a default price — the "Paslauga" dropdown.';

create index if not exists "idx_service_catalog_user_id" on "public"."service_catalog" ("user_id");

drop trigger if exists "trg_service_catalog_updated_at" on "public"."service_catalog";
create trigger "trg_service_catalog_updated_at" before update on "public"."service_catalog"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."service_catalog" enable row level security;

drop policy if exists "service_catalog_select_own" on "public"."service_catalog";
create policy "service_catalog_select_own" on "public"."service_catalog"
  for select using (user_id = auth.uid());

drop policy if exists "service_catalog_insert_own" on "public"."service_catalog";
create policy "service_catalog_insert_own" on "public"."service_catalog"
  for insert with check (user_id = auth.uid());

drop policy if exists "service_catalog_update_own" on "public"."service_catalog";
create policy "service_catalog_update_own" on "public"."service_catalog"
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "service_catalog_delete_own" on "public"."service_catalog";
create policy "service_catalog_delete_own" on "public"."service_catalog"
  for delete using (user_id = auth.uid());

revoke all on table "public"."service_catalog" from anon;
grant select, insert, update, delete on table "public"."service_catalog" to authenticated;
grant all on table "public"."service_catalog" to service_role;

-- Start the list from services that were already priced on visits.
insert into "public"."service_catalog" ("user_id", "name", "price")
select distinct on (vs.user_id, vs.title) vs.user_id, vs.title, vs.price
from "public"."visit_services" vs
order by vs.user_id, vs.title, vs.created_at desc
on conflict ("user_id", "name") do nothing;

-- ---- 2. sales_invoice_visits ---------------------------------------------------

create table if not exists "public"."sales_invoice_visits" (
  "invoice_id" uuid not null references "public"."sales_invoices"("id") on delete cascade,
  "visit_id" uuid not null references "public"."visits"("id") on delete cascade,
  "user_id" uuid not null references "auth"."users"("id") on delete cascade,
  "created_at" timestamptz not null default now(),
  primary key ("invoice_id", "visit_id")
);

comment on table "public"."sales_invoice_visits" is 'Visits covered by a sales invoice (one invoice may cover several visits of a client).';

create index if not exists "idx_sales_invoice_visits_visit_id" on "public"."sales_invoice_visits" ("visit_id");
create index if not exists "idx_sales_invoice_visits_user_id" on "public"."sales_invoice_visits" ("user_id");

alter table "public"."sales_invoice_visits" enable row level security;

drop policy if exists "sales_invoice_visits_select_own" on "public"."sales_invoice_visits";
create policy "sales_invoice_visits_select_own" on "public"."sales_invoice_visits"
  for select using (user_id = auth.uid());

revoke all on table "public"."sales_invoice_visits" from anon, authenticated;
grant select on table "public"."sales_invoice_visits" to authenticated;
grant all on table "public"."sales_invoice_visits" to service_role;

insert into "public"."sales_invoice_visits" ("invoice_id", "visit_id", "user_id")
select si.id, si.visit_id, si.user_id
from "public"."sales_invoices" si
where si.visit_id is not null
on conflict do nothing;

notify pgrst, 'reload schema';
