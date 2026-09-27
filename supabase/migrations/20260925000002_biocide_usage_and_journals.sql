-- ============================================================================
-- EQ VET — client feedback round 2: biocidai + veterinariniai žurnalai
--
-- 1. biocide_usage — standalone biocide use (patalpų/įrangos dezinfekcija,
--    kenkėjų kontrolė...), not tied to a visit. Every row writes exactly one
--    usage_items row via trigger, so stock is deducted by the SAME FIFO
--    pipeline as visits (check_batch_stock → update_batch_qty_left, and
--    restore_batch_qty_left on delete). usage_items therefore now belongs to
--    either a visit OR a biocide_usage row.
-- 2. visits gets the remaining fields of the official "Gydomų gyvūnų
--    registracijos žurnalas" form: first symptoms date, tests, outcome.
-- 3. Journal views (security_invoker, so RLS/tenant isolation still applies):
--    - vw_treated_animals_registry  — Gydomų gyvūnų registracijos žurnalas
--    - vw_vet_drug_journal          — Veterinarinių vaistų ir vaistinių
--                                     preparatų apskaitos žurnalas
--    - vw_biocide_receiving_journal — Biocidų žurnalas, gavimas (1–6 st.)
--    - vw_biocide_journal           — Biocidų žurnalas, sunaudojimas (7–12 st.)
--    Ported from VAIDA_VET_INTERFACE / MONIKA_UKIS_INTERFACE, adapted to this
--    schema (clients as owners, batches.lot, usage_items as the only ledger).
--
-- Category comparisons use ::text so this file never "uses" the new
-- 'biocides' enum value as a literal (see 20260925000001).
--
-- Run this AFTER 20260925000001_biocide_category.sql.
-- ============================================================================

-- ============================================================================
-- 1. visits — remaining treated-animals-registry fields
-- ============================================================================

alter table "public"."visits"
  add column if not exists "first_symptoms_date" date,
  add column if not exists "tests" text,
  add column if not exists "outcome" text;

comment on column "public"."visits"."first_symptoms_date" is 'Pirmųjų ligos požymių data (Gydomų gyvūnų registracijos žurnalas).';
comment on column "public"."visits"."tests" is 'Atlikti tyrimai (Gydomų gyvūnų registracijos žurnalas).';
comment on column "public"."visits"."outcome" is 'Ligos baigtis, e.g. pasveiko / tęsiamas gydymas / nugaišo (Gydomų gyvūnų registracijos žurnalas).';

-- ============================================================================
-- 2. biocide_usage
-- ============================================================================

create table if not exists "public"."biocide_usage" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "product_id" uuid not null references "public"."products"("id") on delete cascade,
  "batch_id" uuid not null references "public"."batches"("id") on delete cascade,
  "use_date" date not null default current_date,
  "qty" numeric not null check ("qty" > 0),
  "unit" "public"."unit" not null,
  "purpose" text,
  "work_scope" text,
  "used_by_name" text,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

comment on table "public"."biocide_usage" is 'Standalone biocide use (Biocidų žurnalas, 7–12 st.). Each row auto-creates one usage_items row, which deducts stock.';

create index if not exists "idx_biocide_usage_user_id" on "public"."biocide_usage" ("user_id");
create index if not exists "idx_biocide_usage_product_id" on "public"."biocide_usage" ("product_id");
create index if not exists "idx_biocide_usage_use_date" on "public"."biocide_usage" ("use_date");

alter table "public"."biocide_usage" enable row level security;

drop policy if exists "biocide_usage_select_own" on "public"."biocide_usage";
create policy "biocide_usage_select_own" on "public"."biocide_usage"
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "biocide_usage_insert_own" on "public"."biocide_usage";
create policy "biocide_usage_insert_own" on "public"."biocide_usage"
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "biocide_usage_update_own" on "public"."biocide_usage";
create policy "biocide_usage_update_own" on "public"."biocide_usage"
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "biocide_usage_delete_own" on "public"."biocide_usage";
create policy "biocide_usage_delete_own" on "public"."biocide_usage"
  for delete using (user_id = auth.uid() or public.is_admin());

revoke all on table "public"."biocide_usage" from anon;
grant select, insert, update, delete on table "public"."biocide_usage" to authenticated;
grant all on table "public"."biocide_usage" to service_role;

-- ---- usage_items: belongs to a visit OR a biocide_usage row ---------------

alter table "public"."usage_items" alter column "visit_id" drop not null;

alter table "public"."usage_items"
  add column if not exists "biocide_usage_id" uuid references "public"."biocide_usage"("id") on delete cascade;

create index if not exists "idx_usage_items_biocide_usage_id" on "public"."usage_items" ("biocide_usage_id");

alter table "public"."usage_items" drop constraint if exists "usage_items_source_check";
alter table "public"."usage_items" add constraint "usage_items_source_check"
  check (num_nonnulls("visit_id", "biocide_usage_id") = 1);

comment on constraint "usage_items_source_check" on "public"."usage_items" is 'Each consumption row comes from exactly one source: a visit or a standalone biocide_usage entry.';

-- ---- triggers --------------------------------------------------------------

-- Writes the stock-deducting usage_items row. If stock is insufficient,
-- check_batch_stock raises and the whole biocide_usage insert is rolled back.
create or replace function "public"."create_usage_item_from_biocide_usage"()
returns trigger
language plpgsql
as $$
declare
  v_category text;
begin
  select p.category::text into v_category from public.products p where p.id = new.product_id;
  if v_category is distinct from 'biocides' then
    raise exception 'Produktas nėra biocidas (kategorija „Biocidai“)';
  end if;

  insert into public.usage_items (user_id, biocide_usage_id, product_id, batch_id, qty, unit)
  values (new.user_id, new.id, new.product_id, new.batch_id, new.qty, new.unit);

  return new;
end;
$$;

drop trigger if exists "trg_create_usage_item_from_biocide_usage" on "public"."biocide_usage";
create trigger "trg_create_usage_item_from_biocide_usage" after insert on "public"."biocide_usage"
  for each row execute function "public"."create_usage_item_from_biocide_usage"();

-- Stock-affecting fields are immutable after insert — delete + re-create
-- instead, so the usage_items ledger never drifts from biocide_usage.
create or replace function "public"."guard_biocide_usage_stock_fields"()
returns trigger
language plpgsql
as $$
begin
  if new.product_id is distinct from old.product_id
     or new.batch_id is distinct from old.batch_id
     or new.qty is distinct from old.qty
     or new.unit is distinct from old.unit then
    raise exception 'Produkto, partijos ar kiekio keisti negalima — ištrinkite įrašą ir sukurkite naują';
  end if;
  return new;
end;
$$;

drop trigger if exists "trg_guard_biocide_usage_stock_fields" on "public"."biocide_usage";
create trigger "trg_guard_biocide_usage_stock_fields" before update on "public"."biocide_usage"
  for each row execute function "public"."guard_biocide_usage_stock_fields"();

drop trigger if exists "trg_biocide_usage_updated_at" on "public"."biocide_usage";
create trigger "trg_biocide_usage_updated_at" before update on "public"."biocide_usage"
  for each row execute function "public"."touch_updated_at"();

-- ============================================================================
-- 3. stock_movements — visit join becomes optional (biocide rows have none)
-- ============================================================================

drop view if exists "public"."stock_movements";

create view "public"."stock_movements" as
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
  coalesce(a.tag_no, case when ui.biocide_usage_id is not null then 'Biocidai' end) as animal_tag
from "public"."usage_items" ui
join "public"."products" p on p.id = ui.product_id
join "public"."batches" b on b.id = ui.batch_id
left join "public"."visits" v on v.id = ui.visit_id
left join "public"."animals" a on a.id = v.animal_id
order by movement_at desc;

alter view "public"."stock_movements" set (security_invoker = true);

-- ============================================================================
-- 4. visit_history_view — surface the new visit fields
-- ============================================================================

drop view if exists "public"."visit_history_view";

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
      'batch_lot', b.lot,
      'administration_route', ui.administration_route
    ) order by ui.created_at), '[]'::jsonb)
    from public.usage_items ui
    join public.products p on p.id = ui.product_id
    left join public.batches b on b.id = ui.batch_id
    where ui.visit_id = v.id
  ) as products_used,
  v.first_symptoms_date,
  v.tests,
  v.outcome
from public.visits v
left join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id
order by v.visit_date desc, v.created_at desc;

alter view "public"."visit_history_view" set (security_invoker = true);

-- ============================================================================
-- 5. Gydomų gyvūnų registracijos žurnalas — one row per visit with an animal
-- ============================================================================

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
  v.vet_name as veterinarian,
  v.notes
from public.visits v
join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id;

comment on view "public"."vw_treated_animals_registry" is 'GYDOMŲ GYVŪNŲ REGISTRACIJOS ŽURNALAS: one row per visit, medicines used on that visit aggregated with dose and series.';

alter view "public"."vw_treated_animals_registry" set (security_invoker = true);

-- ============================================================================
-- 6. Veterinarinių vaistų ir vaistinių preparatų apskaitos žurnalas
--    One row per received batch: received / used / remaining. quantity_used
--    is received_qty - qty_left, i.e. exactly what the usage_items triggers
--    have deducted from that batch.
-- ============================================================================

create or replace view "public"."vw_vet_drug_journal" as
select
  b.id as batch_id,
  b.user_id,
  b.product_id,
  p.name as product_name,
  p.category,
  p.registration_code,
  p.active_substance,
  b.unit,
  coalesce(b.doc_date, b.created_at::date) as receipt_date,
  s.name as supplier_name,
  b.doc_title,
  b.doc_number,
  b.doc_date,
  b.lot as batch_number,
  b.mfg_date,
  b.expiry_date,
  b.received_qty as quantity_received,
  b.received_qty - coalesce(b.qty_left, b.received_qty) as quantity_used,
  coalesce(b.qty_left, b.received_qty) as quantity_remaining,
  b.created_at
from public.batches b
join public.products p on p.id = b.product_id
left join public.suppliers s on s.id = b.supplier_id
where p.category::text in ('medicines', 'vaccines');

comment on view "public"."vw_vet_drug_journal" is 'VETERINARINIŲ VAISTŲ IR VAISTINIŲ PREPARATŲ APSKAITOS ŽURNALAS: per-batch received/used/remaining for medicines and vaccines, grouped by product in the UI.';

alter view "public"."vw_vet_drug_journal" set (security_invoker = true);

-- ============================================================================
-- 7. Biocidinių produktų apskaitos žurnalas
-- ============================================================================

-- 7a. Receiving side (columns 1–6): one row per received biocide batch.
create or replace view "public"."vw_biocide_receiving_journal" as
select
  b.id as batch_id,
  b.user_id,
  b.product_id,
  p.name as biocide_name,
  p.registration_code,
  p.active_substance,
  b.unit,
  coalesce(b.doc_date, b.created_at::date) as receipt_date,
  s.name as supplier_name,
  b.doc_title,
  b.doc_number,
  b.doc_date,
  b.received_qty as quantity_received,
  b.mfg_date,
  b.expiry_date,
  b.lot as batch_number,
  b.created_at
from public.batches b
join public.products p on p.id = b.product_id
left join public.suppliers s on s.id = b.supplier_id
where p.category::text = 'biocides';

comment on view "public"."vw_biocide_receiving_journal" is 'BIOCIDINIŲ PRODUKTŲ APSKAITOS ŽURNALAS, gavimas (1–6 st.): one row per received biocide batch.';

alter view "public"."vw_biocide_receiving_journal" set (security_invoker = true);

-- 7b. Usage side (columns 7–12): every usage_items row of a biocide product —
-- both standalone biocide_usage entries AND biocides written off inside a
-- visit — so the journal can never miss a consumption. quantity_remaining is
-- a running balance: everything received for the product up to that use
-- date, minus cumulative use up to and including that row.
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
    coalesce(nullif(trim(bu.used_by_name), ''), v.vet_name) as applied_by,
    bu.notes,
    ui.created_at
  from public.usage_items ui
  join public.products p on p.id = ui.product_id
  join public.batches b on b.id = ui.batch_id
  left join public.biocide_usage bu on bu.id = ui.biocide_usage_id
  left join public.visits v on v.id = ui.visit_id
  left join public.animals a on a.id = v.animal_id
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
  u.created_at
from uses u
join public.products p on p.id = u.product_id;

comment on view "public"."vw_biocide_journal" is 'BIOCIDINIŲ PRODUKTŲ APSKAITOS ŽURNALAS, sunaudojimas (7–12 st.): every biocide usage_items row (standalone or in a visit) with a running remaining-stock balance.';

alter view "public"."vw_biocide_journal" set (security_invoker = true);

-- ============================================================================
-- 8. Grants for the (re)created views
-- ============================================================================

do $$
declare
  obj text;
begin
  for obj in select unnest(array[
    'stock_movements', 'visit_history_view', 'vw_treated_animals_registry',
    'vw_vet_drug_journal', 'vw_biocide_receiving_journal', 'vw_biocide_journal'
  ])
  loop
    execute format('revoke all on table "public".%I from anon', obj);
    execute format('grant select on table "public".%I to authenticated', obj);
    execute format('grant all on table "public".%I to service_role', obj);
  end loop;
end $$;

notify pgrst, 'reload schema';
