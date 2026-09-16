-- ============================================================================
-- EQ VET — veterinary stock & visit management system
-- Initial schema: extensions, enums, tables, indexes, views, functions, triggers
--
-- Multi-tenant on a single Supabase project: every business table carries
-- user_id (default auth.uid()) and is isolated by RLS in the next migration.
-- Two independent vets share this project but never see each other's rows.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

do $$ begin
  create type "public"."unit" as enum ('ml', 'l', 'g', 'kg', 'vnt', 'tabletkė', 'dozė');
exception when duplicate_object then null; end $$;

do $$ begin
  create type "public"."product_category" as enum ('medicines', 'vaccines', 'materials', 'hygiene', 'other');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ---- Profiles (1:1 with auth.users, created by handle_new_user trigger) ----

create table if not exists "public"."profiles" (
  "id" uuid primary key references "auth"."users"("id") on delete cascade,
  "email" text not null,
  "full_name" text not null default '',
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

comment on table "public"."profiles" is 'Profile row per Supabase Auth user. No roles — each user is a fully isolated tenant (see RLS migration).';

-- ---- Suppliers & products ---------------------------------------------

create table if not exists "public"."suppliers" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "name" text not null,
  "code" text,
  "vat_code" text,
  "phone" text,
  "email" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists "public"."products" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "name" text not null,
  "category" "public"."product_category" not null default 'other',
  "unit" "public"."unit" not null,
  "package_size" numeric,
  "active_substance" text,
  "registration_code" text,
  "withdrawal_days_meat" integer,
  "withdrawal_days_milk" integer,
  "notes" text,
  "is_active" boolean not null default true,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

-- ---- Invoices (pajamavimas via PDF import) & batches (pajamavimas) --------

create table if not exists "public"."invoices" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "invoice_number" text,
  "invoice_date" date,
  "supplier_id" uuid references "public"."suppliers"("id") on delete set null,
  "supplier_name" text,
  "supplier_code" text,
  "supplier_vat" text,
  "currency" text default 'EUR',
  "total_net" numeric(12, 2) default 0,
  "total_vat" numeric(12, 2) default 0,
  "total_gross" numeric(12, 2) default 0,
  "pdf_filename" text,
  "created_at" timestamptz default now()
);

create table if not exists "public"."batches" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "product_id" uuid not null references "public"."products"("id") on delete cascade,
  "supplier_id" uuid references "public"."suppliers"("id") on delete set null,
  "invoice_id" uuid references "public"."invoices"("id") on delete set null,
  "lot" text,
  "mfg_date" date,
  "expiry_date" date,
  "doc_title" text default 'Sąskaita',
  "doc_number" text,
  "doc_date" date,
  "purchase_price" numeric(12, 2),
  "currency" text default 'EUR',
  "received_qty" numeric not null check ("received_qty" >= 0),
  "qty_left" numeric,
  "unit" "public"."unit" not null,
  "status" text not null default 'active' check ("status" in ('active', 'depleted', 'expired')),
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

comment on column "public"."batches"."qty_left" is 'Remaining quantity, auto-decremented by a trigger whenever a usage_items row (nurašymas) is inserted. This is the FIFO stock ledger.';

create table if not exists "public"."invoice_items" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "invoice_id" uuid not null references "public"."invoices"("id") on delete cascade,
  "batch_id" uuid references "public"."batches"("id") on delete set null,
  "description" text,
  "quantity" numeric,
  "unit_price" numeric(12, 2),
  "total_price" numeric(12, 2),
  "created_at" timestamptz default now()
);

-- ---- Animals ------------------------------------------------------------

create table if not exists "public"."animals" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "tag_no" text not null,
  "name" text,
  "species" text not null default 'bovine',
  "sex" text,
  "breed" text,
  "birth_date" date,
  "owner_name" text,
  "owner_address" text,
  "owner_phone" text,
  "active" boolean not null default true,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

-- ---- Visits (gydymai) & usage_items (nurašymas) --------------------------

create table if not exists "public"."visits" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "animal_id" uuid references "public"."animals"("id") on delete set null,
  "visit_date" date not null default current_date,
  "reason" text,
  "diagnosis" text,
  "services" text,
  "service_price" numeric(12, 2),
  "vet_name" text,
  "notes" text,
  "withdrawal_until_meat" date,
  "withdrawal_until_milk" date,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists "public"."usage_items" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "visit_id" uuid not null references "public"."visits"("id") on delete cascade,
  "product_id" uuid not null references "public"."products"("id") on delete cascade,
  "batch_id" uuid not null references "public"."batches"("id") on delete cascade,
  "qty" numeric not null check ("qty" > 0),
  "unit" "public"."unit" not null,
  "created_at" timestamptz default now()
);

comment on table "public"."usage_items" is 'Single source of stock consumption (nurašymas). Inserting a row here deducts batches.qty_left via trigger.';

-- ============================================================================
-- INDEXES
-- ============================================================================

create index if not exists "idx_suppliers_user_id" on "public"."suppliers" ("user_id");
create index if not exists "idx_products_user_id" on "public"."products" ("user_id");
create index if not exists "idx_batches_user_id" on "public"."batches" ("user_id");
create index if not exists "idx_batches_product_id" on "public"."batches" ("product_id");
create index if not exists "idx_batches_expiry_date" on "public"."batches" ("expiry_date");
create index if not exists "idx_batches_invoice_id" on "public"."batches" ("invoice_id");
create index if not exists "idx_invoices_user_id" on "public"."invoices" ("user_id");
create index if not exists "idx_invoice_items_invoice_id" on "public"."invoice_items" ("invoice_id");
create index if not exists "idx_animals_user_id" on "public"."animals" ("user_id");
create index if not exists "idx_animals_tag_no" on "public"."animals" ("tag_no");
create index if not exists "idx_visits_user_id" on "public"."visits" ("user_id");
create index if not exists "idx_visits_animal_id" on "public"."visits" ("animal_id");
create index if not exists "idx_visits_visit_date" on "public"."visits" ("visit_date");
create index if not exists "idx_usage_items_user_id" on "public"."usage_items" ("user_id");
create index if not exists "idx_usage_items_visit_id" on "public"."usage_items" ("visit_id");
create index if not exists "idx_usage_items_batch_id" on "public"."usage_items" ("batch_id");

-- ============================================================================
-- VIEWS  (security_invoker set in the RLS migration, after RLS is enabled)
-- ============================================================================

create or replace view "public"."stock_by_batch" as
select
  b.id as batch_id,
  b.user_id,
  p.id as product_id,
  p.name as product_name,
  p.category as product_category,
  b.lot,
  b.expiry_date,
  b.mfg_date,
  b.received_qty,
  b.qty_left,
  b.unit,
  b.status,
  b.purchase_price,
  b.currency,
  b.doc_number,
  b.doc_date,
  s.name as supplier_name,
  case
    when b.expiry_date is not null and b.expiry_date < current_date then 'expired'
    when coalesce(b.qty_left, 0) <= 0 then 'depleted'
    when b.received_qty > 0 and coalesce(b.qty_left, 0) < (b.received_qty * 0.2) then 'low'
    else 'available'
  end as stock_status,
  b.created_at
from "public"."batches" b
join "public"."products" p on p.id = b.product_id
left join "public"."suppliers" s on s.id = b.supplier_id
order by b.created_at desc;

create or replace view "public"."stock_by_product" as
select
  user_id,
  product_id,
  product_name,
  product_category,
  unit,
  sum(qty_left) as on_hand,
  count(*) filter (where stock_status = 'low') as low_stock_batches,
  count(*) filter (where stock_status = 'expired') as expired_batches,
  min(expiry_date) filter (where coalesce(qty_left, 0) > 0) as nearest_expiry
from "public"."stock_by_batch"
group by user_id, product_id, product_name, product_category, unit;

-- Unified movements ledger for the "atsargų judėjimo žurnalas": one row per
-- receiving event (pajamavimas, positive) and one per consumption event
-- (nurašymas, negative).
create or replace view "public"."stock_movements" as
select
  b.id as movement_id,
  b.user_id,
  'pajamavimas'::text as movement_type,
  b.created_at as movement_at,
  b.product_id,
  p.name as product_name,
  b.received_qty as qty,
  b.unit,
  b.lot,
  s.name as supplier_name,
  b.doc_number,
  b.doc_date,
  null::uuid as visit_id,
  null::uuid as animal_id,
  null::text as animal_tag
from "public"."batches" b
join "public"."products" p on p.id = b.product_id
left join "public"."suppliers" s on s.id = b.supplier_id
union all
select
  ui.id as movement_id,
  ui.user_id,
  'nurašymas'::text as movement_type,
  ui.created_at as movement_at,
  ui.product_id,
  p.name as product_name,
  -ui.qty as qty,
  ui.unit,
  b.lot,
  null::text as supplier_name,
  null::text as doc_number,
  null::date as doc_date,
  ui.visit_id,
  v.animal_id,
  a.tag_no as animal_tag
from "public"."usage_items" ui
join "public"."products" p on p.id = ui.product_id
join "public"."batches" b on b.id = ui.batch_id
join "public"."visits" v on v.id = ui.visit_id
left join "public"."animals" a on a.id = v.animal_id
order by movement_at desc;

-- Visit journal (gydymų žurnalas) with products used, per visit.
create or replace view "public"."visit_history_view" as
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
  a.owner_name,
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
order by v.visit_date desc, v.created_at desc;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

create or replace function "public"."touch_updated_at"()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Initializes qty_left = received_qty when a batch is first received.
create or replace function "public"."init_batch_qty_left"()
returns trigger
language plpgsql
as $$
begin
  if new.qty_left is null then
    new.qty_left := new.received_qty;
  end if;
  return new;
end;
$$;

-- Auto-creates a profile row whenever a new Auth user is created.
create or replace function "public"."handle_new_user"()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Suggests the batch to consume next for a product, FIFO by expiry then
-- manufacture date, restricted to the calling user's own batches.
create or replace function "public"."fn_fifo_batch"("p_product_id" uuid)
returns uuid
language sql
stable
security invoker
as $$
  select b.id
  from public.batches b
  where b.product_id = p_product_id
    and b.user_id = auth.uid()
    and coalesce(b.qty_left, 0) > 0
    and (b.expiry_date is null or b.expiry_date >= current_date)
  order by b.expiry_date nulls last, b.mfg_date nulls last, b.created_at
  limit 1;
$$;

-- Validates sufficient stock exists (and that the batch belongs to the
-- inserting user) before allowing a usage_items row.
create or replace function "public"."check_batch_stock"()
returns trigger
language plpgsql
as $$
declare
  v_qty_left numeric;
  v_batch_user uuid;
  v_product_name text;
begin
  select b.qty_left, b.user_id, p.name into v_qty_left, v_batch_user, v_product_name
  from public.batches b
  join public.products p on p.id = b.product_id
  where b.id = new.batch_id;

  if not found then
    raise exception 'Partija nerasta: %', new.batch_id;
  end if;

  if v_batch_user is distinct from new.user_id then
    raise exception 'Partija priklauso kitam vartotojui';
  end if;

  if v_qty_left is null or v_qty_left < new.qty then
    raise exception 'Nepakanka atsargų produktui "%". Turima: %, Reikia: %',
      v_product_name, coalesce(v_qty_left, 0), new.qty;
  end if;

  return new;
end;
$$;

create or replace function "public"."update_batch_qty_left"()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.batches
  set
    qty_left = qty_left - new.qty,
    status = case when (qty_left - new.qty) <= 0 then 'depleted' else status end,
    updated_at = now()
  where id = new.batch_id;

  return new;
end;
$$;

create or replace function "public"."restore_batch_qty_left"()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.batches
  set
    qty_left = qty_left + old.qty,
    status = case when (qty_left + old.qty) > 0 and status = 'depleted' then 'active' else status end,
    updated_at = now()
  where id = old.batch_id;

  return old;
end;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

drop trigger if exists "trg_profiles_updated_at" on "public"."profiles";
create trigger "trg_profiles_updated_at" before update on "public"."profiles"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "trg_suppliers_updated_at" on "public"."suppliers";
create trigger "trg_suppliers_updated_at" before update on "public"."suppliers"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "trg_products_updated_at" on "public"."products";
create trigger "trg_products_updated_at" before update on "public"."products"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "trg_batches_updated_at" on "public"."batches";
create trigger "trg_batches_updated_at" before update on "public"."batches"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "trg_init_batch_qty_left" on "public"."batches";
create trigger "trg_init_batch_qty_left" before insert on "public"."batches"
  for each row execute function "public"."init_batch_qty_left"();

drop trigger if exists "trg_animals_updated_at" on "public"."animals";
create trigger "trg_animals_updated_at" before update on "public"."animals"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "trg_visits_updated_at" on "public"."visits";
create trigger "trg_visits_updated_at" before update on "public"."visits"
  for each row execute function "public"."touch_updated_at"();

drop trigger if exists "on_auth_user_created" on "auth"."users";
create trigger "on_auth_user_created"
  after insert on "auth"."users"
  for each row execute function "public"."handle_new_user"();

-- Stock / usage pipeline
drop trigger if exists "trg_check_batch_stock" on "public"."usage_items";
create trigger "trg_check_batch_stock" before insert on "public"."usage_items"
  for each row execute function "public"."check_batch_stock"();

drop trigger if exists "trg_update_batch_qty_left" on "public"."usage_items";
create trigger "trg_update_batch_qty_left" after insert on "public"."usage_items"
  for each row execute function "public"."update_batch_qty_left"();

drop trigger if exists "trg_restore_batch_qty_left" on "public"."usage_items";
create trigger "trg_restore_batch_qty_left" after delete on "public"."usage_items"
  for each row execute function "public"."restore_batch_qty_left"();
