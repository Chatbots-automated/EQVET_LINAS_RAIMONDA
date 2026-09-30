-- ============================================================================
-- EQ VET — journals round 3
--
-- 1. invoices.saved_to_gvet — a purchase document can be registered ONLY for
--    Sąskaita123 (no batches → no stock, no journals). The row itself stays as
--    the send-status record, so a purchase can never be sent twice.
-- 2. medical_waste — Veterinarinių medicininių atliekų susidarymo apskaitos
--    žurnalas (was missing entirely). Entries are generated automatically:
--    products.package_weight_g (empty package weight) × packages emptied,
--    where a package is emptied every products.package_size used from a batch.
--    medical_waste_settings holds the tenant's fixed journal columns (waste
--    code, carrier, handler, responsible person...), typed in once.
-- 3. Journal views get what the report filters need (client, animal, products).
-- 4. password_change_attempts — throttle for the "change my password" form.
--
-- Run this AFTER 20260930000002_service_catalog_and_invoice_visits.sql.
-- ============================================================================

-- ============================================================================
-- 1. Purchases registered only for Sąskaita123
-- ============================================================================

alter table "public"."invoices"
  add column if not exists "saved_to_gvet" boolean not null default true;

comment on column "public"."invoices"."saved_to_gvet" is 'False = registered only to be sent to Sąskaita123: no batches, so nothing reaches stock or the journals.';

-- ============================================================================
-- 2. Medical waste journal
-- ============================================================================

create table if not exists "public"."medical_waste" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "waste_code" text not null,
  "name" text not null,
  "period" text,
  "date" date not null default current_date,
  "qty_generated" numeric check ("qty_generated" >= 0),
  "qty_transferred" numeric check ("qty_transferred" >= 0),
  "carrier" text,
  "processor" text,
  "transfer_date" date,
  "doc_no" text,
  "responsible" text,
  "notes" text,
  "auto_generated" boolean not null default false,
  "source_batch_id" uuid references "public"."batches"("id") on delete set null,
  "source_product_id" uuid references "public"."products"("id") on delete set null,
  "package_count" integer,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "medical_waste_source_batch_key" unique ("source_batch_id")
);

comment on column "public"."medical_waste"."auto_generated" is 'True = created by the stock trigger from emptied packages (one row per batch, kept up to date as the batch is used).';

comment on table "public"."medical_waste" is 'VETERINARINIŲ MEDICININIŲ ATLIEKŲ SUSIDARYMO APSKAITOS ŽURNALAS: waste generated (kg) and handed over to a waste handler.';

create index if not exists "idx_medical_waste_user_id" on "public"."medical_waste" ("user_id");
create index if not exists "idx_medical_waste_date" on "public"."medical_waste" ("date");

drop trigger if exists "trg_medical_waste_updated_at" on "public"."medical_waste";
create trigger "trg_medical_waste_updated_at" before update on "public"."medical_waste"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."medical_waste" enable row level security;

drop policy if exists "medical_waste_select_own" on "public"."medical_waste";
create policy "medical_waste_select_own" on "public"."medical_waste"
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "medical_waste_insert_own" on "public"."medical_waste";
create policy "medical_waste_insert_own" on "public"."medical_waste"
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "medical_waste_update_own" on "public"."medical_waste";
create policy "medical_waste_update_own" on "public"."medical_waste"
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "medical_waste_delete_own" on "public"."medical_waste";
create policy "medical_waste_delete_own" on "public"."medical_waste"
  for delete using (user_id = auth.uid() or public.is_admin());

revoke all on table "public"."medical_waste" from anon;
grant select, insert, update, delete on table "public"."medical_waste" to authenticated;
grant all on table "public"."medical_waste" to service_role;

-- ---- fixed journal columns, typed in once ------------------------------------

create table if not exists "public"."medical_waste_settings" (
  "user_id" uuid primary key default auth.uid() references "auth"."users"("id") on delete cascade,
  "waste_code" text,
  "waste_name" text,
  "carrier" text,
  "processor" text,
  "responsible" text,
  "doc_no" text,
  "updated_at" timestamptz not null default now()
);

comment on table "public"."medical_waste_settings" is 'Per-tenant fixed values of the medical waste journal (code, name, carrier, handler, responsible, contract no.). Used for automatic entries and wherever a row leaves the column empty.';

drop trigger if exists "trg_medical_waste_settings_updated_at" on "public"."medical_waste_settings";
create trigger "trg_medical_waste_settings_updated_at" before update on "public"."medical_waste_settings"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."medical_waste_settings" enable row level security;

drop policy if exists "medical_waste_settings_select_own" on "public"."medical_waste_settings";
create policy "medical_waste_settings_select_own" on "public"."medical_waste_settings"
  for select using (user_id = auth.uid());

drop policy if exists "medical_waste_settings_insert_own" on "public"."medical_waste_settings";
create policy "medical_waste_settings_insert_own" on "public"."medical_waste_settings"
  for insert with check (user_id = auth.uid());

drop policy if exists "medical_waste_settings_update_own" on "public"."medical_waste_settings";
create policy "medical_waste_settings_update_own" on "public"."medical_waste_settings"
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on table "public"."medical_waste_settings" from anon;
grant select, insert, update on table "public"."medical_waste_settings" to authenticated;
grant all on table "public"."medical_waste_settings" to service_role;

-- ---- automatic entries from emptied packages ------------------------------------

alter table "public"."products"
  add column if not exists "package_weight_g" numeric(10, 2) check ("package_weight_g" > 0);

comment on column "public"."products"."package_weight_g" is 'Weight of ONE empty package in grams. With package_size it drives automatic medical waste entries.';

-- Keeps one auto-generated waste row per batch in step with how many of its
-- packages are empty: floor(used / package_size), or every package once the
-- batch is used up. Weight = packages × package_weight_g. Runs as definer
-- because stock is deducted inside definer triggers; user_id always comes
-- from the batch itself.
create or replace function "public"."sync_batch_medical_waste"()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_settings record;
  v_total integer;
  v_empty integer;
  v_used numeric;
begin
  select p.name, p.package_size, p.package_weight_g into v_product from public.products p where p.id = new.product_id;
  if v_product.package_weight_g is null then
    return new;
  end if;

  v_used := new.received_qty - coalesce(new.qty_left, new.received_qty);
  v_total := coalesce(new.package_count::integer, case when coalesce(v_product.package_size, 0) > 0 then ceil(new.received_qty / v_product.package_size)::integer end);
  if coalesce(new.qty_left, new.received_qty) <= 0 then
    v_empty := coalesce(v_total, 1);
  elsif coalesce(v_product.package_size, 0) > 0 then
    v_empty := least(floor(v_used / v_product.package_size)::integer, coalesce(v_total, 2147483647));
  else
    v_empty := 0;
  end if;

  if v_empty <= 0 then
    -- Stock was restored: drop the automatic row unless it was already handed over.
    delete from public.medical_waste where source_batch_id = new.id and auto_generated and qty_transferred is null;
    return new;
  end if;

  select * into v_settings from public.medical_waste_settings where user_id = new.user_id;

  insert into public.medical_waste (user_id, waste_code, name, date, qty_generated, auto_generated, source_batch_id, source_product_id, package_count, notes)
  values (
    new.user_id,
    coalesce(nullif(trim(v_settings.waste_code), ''), '18 02 03'),
    coalesce(nullif(trim(v_settings.waste_name), ''), 'Tuščios vaistų pakuotės'),
    current_date,
    round(v_empty * v_product.package_weight_g / 1000, 3),
    true,
    new.id,
    new.product_id,
    v_empty,
    concat(v_product.name, case when new.lot is not null then concat(', partija ', new.lot) end, ' — ', v_empty, ' pak.')
  )
  on conflict (source_batch_id) do update
  set qty_generated = excluded.qty_generated,
      package_count = excluded.package_count,
      notes = excluded.notes,
      date = case when public.medical_waste.package_count is distinct from excluded.package_count then excluded.date else public.medical_waste.date end
  where public.medical_waste.auto_generated;

  return new;
end;
$$;

revoke execute on function "public"."sync_batch_medical_waste"() from public, anon, authenticated;

drop trigger if exists "trg_sync_batch_medical_waste" on "public"."batches";
create trigger "trg_sync_batch_medical_waste" after update of "qty_left" on "public"."batches"
  for each row execute function "public"."sync_batch_medical_waste"();

-- ============================================================================
-- 3. Journal views
-- ============================================================================

-- ---- Gydomų gyvūnų registracijos žurnalas: + product ids (for the product filter) ----
-- (new columns are appended — create or replace cannot reorder)
create or replace view "public"."vw_treated_animals_registry" as
select
  v.id as visit_id,
  v.user_id,
  v.visit_date as registration_date,
  v.created_at,
  a.id as animal_id,
  a.tag_no as animal_tag,
  a.name as animal_name,
  a.species,
  a.sex,
  a.birth_date,
  c.id as client_id,
  c.name as owner_name,
  c.address as owner_address,
  v.first_symptoms_date,
  v.reason as animal_condition,
  v.tests,
  v.diagnosis as clinical_diagnosis,
  v.services,
  (
    select string_agg(
      concat(p.name, ' ', trim(to_char(ui.qty, 'FM999999990.###')), ' ', ui.unit::text,
             case when b.lot is not null then concat(' (ser. ', b.lot, ')') end),
      '; ' order by ui.created_at)
    from public.usage_items ui
    join public.products p on p.id = ui.product_id
    left join public.batches b on b.id = ui.batch_id
    where ui.visit_id = v.id
      and p.category::text <> 'biocides'
  ) as medicines,
  v.outcome,
  coalesce(nullif(trim(v.vet_name), ''), nullif(trim(pr.full_name), '')) as veterinarian,
  v.notes,
  coalesce((select array_agg(distinct ui.product_id) from public.usage_items ui where ui.visit_id = v.id), '{}'::uuid[]) as product_ids
from public.visits v
join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id
left join public.profiles pr on pr.id = v.user_id;

alter view "public"."vw_treated_animals_registry" set (security_invoker = true);

-- ---- Biocidų žurnalas (sunaudojimas): + client / animal of the visit ----------
create or replace view "public"."vw_biocide_journal" as
with uses as (
  select
    ui.id as entry_id,
    ui.user_id,
    ui.product_id,
    ui.biocide_usage_id,
    ui.visit_id,
    coalesce(bu.use_date, v.visit_date, ui.created_at::date) as use_date,
    coalesce(
      nullif(trim(bu.purpose), ''),
      nullif(trim(v.reason), ''),
      case when ui.visit_id is not null then 'Naudota vizito metu' end
    ) as purpose,
    coalesce(
      nullif(trim(bu.work_scope), ''),
      case when a.tag_no is not null then concat('Gyvūnas ', a.tag_no) end
    ) as work_scope,
    ui.qty as quantity_used,
    ui.unit,
    b.lot as batch_number,
    b.expiry_date as batch_expiry,
    coalesce(nullif(trim(bu.used_by_name), ''), nullif(trim(v.vet_name), ''), nullif(trim(pr.full_name), '')) as applied_by,
    bu.notes,
    ui.created_at,
    a.id as animal_id,
    a.client_id
  from public.usage_items ui
  join public.products p on p.id = ui.product_id
  join public.batches b on b.id = ui.batch_id
  left join public.biocide_usage bu on bu.id = ui.biocide_usage_id
  left join public.visits v on v.id = ui.visit_id
  left join public.animals a on a.id = v.animal_id
  left join public.profiles pr on pr.id = ui.user_id
  where p.category::text = 'biocides'
)
select
  u.entry_id,
  u.user_id,
  u.product_id,
  p.name as biocide_name,
  p.registration_code,
  p.active_substance,
  u.biocide_usage_id,
  u.visit_id,
  u.use_date,
  u.purpose,
  u.work_scope,
  u.quantity_used,
  u.unit,
  u.batch_number,
  u.batch_expiry,
  u.applied_by,
  u.notes,
  (
    select coalesce(sum(b2.received_qty), 0)
    from public.batches b2
    where b2.product_id = u.product_id
      and coalesce(b2.doc_date, b2.created_at::date) <= u.use_date
  ) - sum(u.quantity_used) over (
    partition by u.product_id
    order by u.use_date, u.created_at, u.entry_id
    rows between unbounded preceding and current row
  ) as quantity_remaining,
  u.created_at,
  u.animal_id,
  u.client_id
from uses u
join public.products p on p.id = u.product_id;

alter view "public"."vw_biocide_journal" set (security_invoker = true);

-- ---- Atsargų judėjimas: + client of the visit ---------------------------------
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
  null::text as animal_tag,
  null::uuid as client_id,
  null::text as client_name
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
  coalesce(a.tag_no, case when ui.biocide_usage_id is not null then 'Biocidai' end) as animal_tag,
  a.client_id,
  c.name as client_name
from "public"."usage_items" ui
join "public"."products" p on p.id = ui.product_id
join "public"."batches" b on b.id = ui.batch_id
left join "public"."visits" v on v.id = ui.visit_id
left join "public"."animals" a on a.id = v.animal_id
left join "public"."clients" c on c.id = a.client_id
order by movement_at desc;

alter view "public"."stock_movements" set (security_invoker = true);

-- ============================================================================
-- 4. Password-change throttle (server / service_role only)
-- ============================================================================

create table if not exists "public"."password_change_attempts" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null references "auth"."users"("id") on delete cascade,
  "succeeded" boolean not null,
  "created_at" timestamptz not null default now()
);

comment on table "public"."password_change_attempts" is 'Every attempt to change a password from Nustatymai. Used to lock the form after repeated wrong current passwords. service_role only.';

create index if not exists "idx_password_change_attempts_user" on "public"."password_change_attempts" ("user_id", "created_at" desc);

alter table "public"."password_change_attempts" enable row level security;
revoke all on table "public"."password_change_attempts" from anon, authenticated;
grant all on table "public"."password_change_attempts" to service_role;

notify pgrst, 'reload schema';
