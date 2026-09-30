-- ============================================================================
-- EQ VET — visit pricing ("Vizito užbaigimas") + names in journals
--
-- 1. products.markup_percent — default antkainis per product, remembered from
--    the last time a visit was priced.
-- 2. usage_items gets a price snapshot: unit_cost (batch purchase price per
--    unit at the moment of use), markup_percent and sale_total (the selling
--    price of that line — the authoritative amount that goes on the invoice).
--    A BEFORE INSERT trigger fills them in, so every write-off is pre-priced.
-- 3. visit_services — one row per service of a visit with its own price
--    (visits.services / visits.service_price stay as the text + sum, so the
--    journals and older code keep working).
-- 4. visits.completed_at — set when the vet confirms prices in the
--    "Vizito užbaigimas" modal.
-- 5. save_visit_pricing() — saves all of the above atomically.
-- 6. visit_history_view — surfaces prices, services, totals.
-- 7. Journals: the vet's / user's name falls back to the account's full name
--    (profiles.full_name) when it wasn't typed in.
--
-- Run this AFTER 20260929000001_invoice123_purchases.sql (and make sure
-- 20260925000001 + 20260925000002 have been run — this file needs them).
-- ============================================================================

-- ============================================================================
-- 1–4. Columns + visit_services
-- ============================================================================

alter table "public"."products"
  add column if not exists "markup_percent" numeric(7, 2) check ("markup_percent" >= 0);

comment on column "public"."products"."markup_percent" is 'Default antkainis (%) applied to the purchase cost when this product is used in a visit. Remembered from the last priced visit.';

alter table "public"."usage_items"
  add column if not exists "unit_cost" numeric(14, 6),
  add column if not exists "markup_percent" numeric(7, 2),
  add column if not exists "sale_total" numeric(12, 2);

comment on column "public"."usage_items"."unit_cost" is 'Purchase cost per unit at the moment of use (batches.purchase_price / received_qty). Snapshot — later batch edits do not change it.';
comment on column "public"."usage_items"."markup_percent" is 'Antkainis (%) applied to this line.';
comment on column "public"."usage_items"."sale_total" is 'Selling price of this line (cost × qty × (1 + antkainis)), as confirmed by the vet. This is what goes on the invoice.';

alter table "public"."visits"
  add column if not exists "completed_at" timestamptz;

comment on column "public"."visits"."completed_at" is 'When prices were confirmed in the "Vizito užbaigimas" modal. Null = visit not priced yet.';

create table if not exists "public"."visit_services" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "visit_id" uuid not null references "public"."visits"("id") on delete cascade,
  "title" text not null,
  "price" numeric(12, 2) check ("price" >= 0),
  "position" integer not null default 0,
  "created_at" timestamptz not null default now()
);

comment on table "public"."visit_services" is 'Services of a visit, each with its own price. visits.services (text) and visits.service_price (sum) are kept in sync by save_visit_pricing().';

create index if not exists "idx_visit_services_user_id" on "public"."visit_services" ("user_id");
create index if not exists "idx_visit_services_visit_id" on "public"."visit_services" ("visit_id");

alter table "public"."visit_services" enable row level security;

drop policy if exists "visit_services_select_own" on "public"."visit_services";
create policy "visit_services_select_own" on "public"."visit_services"
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "visit_services_insert_own" on "public"."visit_services";
create policy "visit_services_insert_own" on "public"."visit_services"
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "visit_services_update_own" on "public"."visit_services";
create policy "visit_services_update_own" on "public"."visit_services"
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "visit_services_delete_own" on "public"."visit_services";
create policy "visit_services_delete_own" on "public"."visit_services"
  for delete using (user_id = auth.uid() or public.is_admin());

revoke all on table "public"."visit_services" from anon;
grant select, insert, update, delete on table "public"."visit_services" to authenticated;
grant all on table "public"."visit_services" to service_role;

-- ============================================================================
-- 2b. Price snapshot on every write-off
-- ============================================================================

create or replace function "public"."set_usage_item_pricing"()
returns trigger
language plpgsql
as $$
declare
  v_purchase numeric;
  v_received numeric;
  v_markup numeric;
begin
  if new.unit_cost is null then
    select b.purchase_price, b.received_qty into v_purchase, v_received
    from public.batches b
    where b.id = new.batch_id;
    if v_purchase is not null and coalesce(v_received, 0) > 0 then
      new.unit_cost := round(v_purchase / v_received, 6);
    end if;
  end if;

  if new.markup_percent is null then
    select p.markup_percent into v_markup from public.products p where p.id = new.product_id;
    new.markup_percent := v_markup;
  end if;

  if new.sale_total is null and new.unit_cost is not null then
    new.sale_total := round(new.unit_cost * new.qty * (1 + coalesce(new.markup_percent, 0) / 100), 2);
  end if;

  return new;
end;
$$;

drop trigger if exists "trg_set_usage_item_pricing" on "public"."usage_items";
create trigger "trg_set_usage_item_pricing" before insert on "public"."usage_items"
  for each row execute function "public"."set_usage_item_pricing"();

-- Existing write-offs: snapshot the cost (no markup, no selling price yet).
update "public"."usage_items" ui
set "unit_cost" = round(b.purchase_price / b.received_qty, 6)
from "public"."batches" b
where b.id = ui.batch_id
  and ui.unit_cost is null
  and b.purchase_price is not null
  and coalesce(b.received_qty, 0) > 0;

-- ============================================================================
-- 5. save_visit_pricing — one atomic save for the "Vizito užbaigimas" modal
--    p_services: [{ "title": "Gydymas", "price": 25 | null }, ...]
--    p_items:    [{ "id": <usage_items.id>, "markup_percent": 10 | null, "sale_total": 11 | null }, ...]
--    security invoker → RLS still decides which rows the caller may touch.
-- ============================================================================

create or replace function "public"."save_visit_pricing"(
  "p_visit_id" uuid,
  "p_services" jsonb,
  "p_items" jsonb,
  "p_complete" boolean default true
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid;
  v_pos integer := 0;
  s jsonb;
  i jsonb;
  v_product uuid;
begin
  select user_id into v_user from public.visits where id = p_visit_id;
  if not found then
    raise exception 'Vizitas nerastas';
  end if;

  delete from public.visit_services where visit_id = p_visit_id;

  for s in select * from jsonb_array_elements(coalesce(p_services, '[]'::jsonb))
  loop
    if nullif(trim(s->>'title'), '') is null then
      continue;
    end if;
    insert into public.visit_services (user_id, visit_id, title, price, position)
    values (v_user, p_visit_id, trim(s->>'title'), nullif(s->>'price', '')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    update public.usage_items
    set markup_percent = nullif(i->>'markup_percent', '')::numeric,
        sale_total = nullif(i->>'sale_total', '')::numeric
    where id = (i->>'id')::uuid
      and visit_id = p_visit_id
    returning product_id into v_product;

    -- Remember the markup as the product's default for next time.
    if found and nullif(i->>'markup_percent', '') is not null then
      update public.products
      set markup_percent = (i->>'markup_percent')::numeric
      where id = v_product
        and markup_percent is distinct from (i->>'markup_percent')::numeric;
    end if;
  end loop;

  update public.visits
  set services = (select string_agg(vs.title, ', ' order by vs.position) from public.visit_services vs where vs.visit_id = p_visit_id),
      service_price = (select sum(vs.price) from public.visit_services vs where vs.visit_id = p_visit_id),
      completed_at = case when p_complete then coalesce(completed_at, now()) else completed_at end
  where id = p_visit_id;
end;
$$;

revoke execute on function "public"."save_visit_pricing"(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function "public"."save_visit_pricing"(uuid, jsonb, jsonb, boolean) to authenticated, service_role;

-- ============================================================================
-- 6. visit_history_view — prices, services, totals
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
      'usage_item_id', ui.id,
      'product_id', ui.product_id,
      'product_name', p.name,
      'quantity', ui.qty,
      'unit', ui.unit,
      'batch_lot', b.lot,
      'administration_route', ui.administration_route,
      'unit_cost', ui.unit_cost,
      'markup_percent', ui.markup_percent,
      'sale_total', ui.sale_total
    ) order by ui.created_at), '[]'::jsonb)
    from public.usage_items ui
    join public.products p on p.id = ui.product_id
    left join public.batches b on b.id = ui.batch_id
    where ui.visit_id = v.id
  ) as products_used,
  v.first_symptoms_date,
  v.tests,
  v.outcome,
  v.completed_at,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', vs.id,
      'title', vs.title,
      'price', vs.price
    ) order by vs.position), '[]'::jsonb)
    from public.visit_services vs
    where vs.visit_id = v.id
  ) as service_lines,
  (
    select sum(ui.sale_total) from public.usage_items ui where ui.visit_id = v.id
  ) as medicines_total,
  coalesce(v.service_price, 0)
    + coalesce((select sum(ui.sale_total) from public.usage_items ui where ui.visit_id = v.id), 0) as total_price
from public.visits v
left join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id
order by v.visit_date desc, v.created_at desc;

alter view "public"."visit_history_view" set (security_invoker = true);

revoke all on table "public"."visit_history_view" from anon;
grant select on table "public"."visit_history_view" to authenticated;
grant all on table "public"."visit_history_view" to service_role;

-- ============================================================================
-- 7. Journals — name falls back to the account's full name
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
  coalesce(nullif(trim(v.vet_name), ''), nullif(trim(pr.full_name), '')) as veterinarian,
  v.notes
from public.visits v
join public.animals a on a.id = v.animal_id
left join public.clients c on c.id = a.client_id
left join public.profiles pr on pr.id = v.user_id;

alter view "public"."vw_treated_animals_registry" set (security_invoker = true);

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
    ui.created_at
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
  u.created_at
from uses u
join public.products p on p.id = u.product_id;

alter view "public"."vw_biocide_journal" set (security_invoker = true);

notify pgrst, 'reload schema';
