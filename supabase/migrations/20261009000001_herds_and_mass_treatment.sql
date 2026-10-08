-- ============================================================================
-- EQ VET — herds (bandos numeris) and mass treatment / vaccination
--
-- 1. animals.herd_no: free-text herd number. One client can have many herds;
--    the UI suggests the herd numbers already used under the chosen client.
-- 2. create_mass_treatment(): treat / vaccinate a whole group in ONE
--    transaction. For every animal it creates a normal visit (so the animal
--    shows up in the treated-animals registry, visit history, invoicing...)
--    and one usage_items row per product, which deducts stock and feeds the
--    drug journal exactly like a hand-entered visit does.
--      - batch given  → every animal draws from that batch;
--      - batch null   → FIFO (soonest expiry first) across the product's
--        batches, splitting one animal's dose over two batches if needed.
--    If stock runs out half-way, nothing is saved at all.
--
-- Run this AFTER 20261008000001_edit_purchases.sql.
-- ============================================================================

alter table "public"."animals" add column if not exists "herd_no" text;

comment on column "public"."animals"."herd_no" is 'Bandos numeris. Free text; unique only in the sense that a client may have many herds.';

create index if not exists "idx_animals_client_herd" on "public"."animals" ("client_id", "herd_no") where "herd_no" is not null;

-- ---- mass treatment -----------------------------------------------------------

create or replace function "public"."create_mass_treatment"(
  "p_animal_ids" uuid[],
  "p_visit_date" date,
  "p_vet_name" text,
  "p_reason" text,
  "p_diagnosis" text,
  "p_notes" text,
  "p_items" jsonb  -- [{ "product_id": uuid, "batch_id": uuid | null, "qty": number (per animal) }]
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_animals uuid[];
  v_animal uuid;
  v_visit uuid;
  v_item jsonb;
  v_product record;
  v_batch record;
  v_batch_id uuid;
  v_qty numeric;
  v_remaining numeric;
  v_take numeric;
  v_available numeric;
  v_visits integer := 0;
  v_rows integer := 0;
begin
  select coalesce(array_agg(distinct x), '{}') into v_animals from unnest(p_animal_ids) as x;
  if cardinality(v_animals) = 0 then
    raise exception 'Pasirinkite bent vieną gyvūną.';
  end if;
  if cardinality(v_animals) > 500 then
    raise exception 'Vienu metu galima apdoroti iki 500 gyvūnų.';
  end if;
  if p_visit_date is null then
    raise exception 'Įveskite datą.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pridėkite bent vieną produktą.';
  end if;

  -- Every animal must be one of the caller's own (RLS hides the rest).
  if (select count(*) from public.animals a where a.id = any(v_animals) and a.user_id = auth.uid()) <> cardinality(v_animals) then
    raise exception 'Kai kurie gyvūnai nerasti.';
  end if;

  -- Validate the products and make sure there is enough stock for the whole group
  -- before anything is written, so the message can name the product.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Kiekis vienam gyvūnui turi būti didesnis už 0.';
    end if;

    select p.id, p.name, p.unit, p.category into v_product
    from public.products p where p.id = (v_item->>'product_id')::uuid and p.user_id = auth.uid();
    if not found then
      raise exception 'Produktas nerastas.';
    end if;
    if v_product.category = 'biocides' then
      raise exception 'Biocidai registruojami Biocidų skyriuje: %.', v_product.name;
    end if;

    if nullif(v_item->>'batch_id', '') is not null then
      select coalesce(b.qty_left, 0) into v_available
      from public.batches b
      where b.id = (v_item->>'batch_id')::uuid and b.product_id = v_product.id and b.user_id = auth.uid();
      if not found then
        raise exception 'Partija nerasta: %.', v_product.name;
      end if;
    else
      select coalesce(sum(b.qty_left), 0) into v_available
      from public.batches b
      where b.product_id = v_product.id and b.user_id = auth.uid()
        and coalesce(b.qty_left, 0) > 0 and b.unit = v_product.unit
        and (b.expiry_date is null or b.expiry_date >= current_date);
    end if;

    if v_available < v_qty * cardinality(v_animals) then
      raise exception 'Nepakanka atsargų produktui "%". Reikia: % %, turima: % %.',
        v_product.name, trim_scale(v_qty * cardinality(v_animals)), v_product.unit, trim_scale(v_available), v_product.unit;
    end if;
  end loop;

  foreach v_animal in array v_animals loop
    insert into public.visits (animal_id, visit_date, reason, diagnosis, vet_name, notes)
    values (
      v_animal, p_visit_date,
      nullif(trim(p_reason), ''), nullif(trim(p_diagnosis), ''),
      nullif(trim(p_vet_name), ''), nullif(trim(p_notes), '')
    )
    returning id into v_visit;
    v_visits := v_visits + 1;

    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_item->>'qty')::numeric;
      v_batch_id := nullif(v_item->>'batch_id', '')::uuid;
      select p.id, p.name, p.unit into v_product from public.products p where p.id = (v_item->>'product_id')::uuid;

      if v_batch_id is not null then
        insert into public.usage_items (visit_id, product_id, batch_id, qty, unit)
        select v_visit, v_product.id, b.id, v_qty, b.unit from public.batches b where b.id = v_batch_id;
        v_rows := v_rows + 1;
      else
        v_remaining := v_qty;
        for v_batch in
          select b.id, b.qty_left, b.unit
          from public.batches b
          where b.product_id = v_product.id and b.user_id = auth.uid()
            and coalesce(b.qty_left, 0) > 0 and b.unit = v_product.unit
            and (b.expiry_date is null or b.expiry_date >= current_date)
          order by b.expiry_date nulls last, b.mfg_date nulls last, b.created_at
          for update
        loop
          v_take := least(v_remaining, v_batch.qty_left);
          insert into public.usage_items (visit_id, product_id, batch_id, qty, unit)
          values (v_visit, v_product.id, v_batch.id, v_take, v_batch.unit);
          v_rows := v_rows + 1;
          v_remaining := v_remaining - v_take;
          exit when v_remaining <= 0;
        end loop;

        if v_remaining > 0 then
          raise exception 'Nepakanka atsargų produktui "%".', v_product.name;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('visits', v_visits, 'usage_rows', v_rows);
end;
$$;

revoke execute on function "public"."create_mass_treatment"(uuid[], date, text, text, text, text, jsonb) from public, anon;
grant execute on function "public"."create_mass_treatment"(uuid[], date, text, text, text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
