-- ============================================================================
-- EQ VET — administration-route-specific withdrawal (karencija) periods
--
-- Different administration routes (i.v, i.m, s.c, i.u, i.mm, p.o.s) can carry
-- different withdrawal periods for the same product. Mirrors Vaida's
-- administrationRoutes.ts / WithdrawalRouteFields pattern: 6 routes × 2
-- (meat/milk) = 12 optional override columns on products, falling back to
-- the product's plain withdrawal_days_meat/withdrawal_days_milk when a
-- route isn't set or has no override.
--
-- usage_items gets administration_route so a visit's Kiekis line can record
-- which route was used, and the app computes withdrawal_until_meat/milk on
-- the visit dynamically from the max across its lines.
--
-- Run this AFTER 20260917000002_supplier_bank_fields.sql.
-- ============================================================================

alter table "public"."products"
  add column if not exists "withdrawal_iv_meat" integer,
  add column if not exists "withdrawal_iv_milk" integer,
  add column if not exists "withdrawal_im_meat" integer,
  add column if not exists "withdrawal_im_milk" integer,
  add column if not exists "withdrawal_sc_meat" integer,
  add column if not exists "withdrawal_sc_milk" integer,
  add column if not exists "withdrawal_iu_meat" integer,
  add column if not exists "withdrawal_iu_milk" integer,
  add column if not exists "withdrawal_imm_meat" integer,
  add column if not exists "withdrawal_imm_milk" integer,
  add column if not exists "withdrawal_pos_meat" integer,
  add column if not exists "withdrawal_pos_milk" integer;

comment on column "public"."products"."withdrawal_iv_meat" is 'Route-specific withdrawal override (i.v, mėsa). Falls back to withdrawal_days_meat when null.';

alter table "public"."usage_items" add column if not exists "administration_route" text;

comment on column "public"."usage_items"."administration_route" is 'Administration route used for this dose: iv, im, sc, iu, imm, pos. Drives which route-specific withdrawal override applies.';

-- Surface administration_route in the visit journal's products_used JSON.
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
