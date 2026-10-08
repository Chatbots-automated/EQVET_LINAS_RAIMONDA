-- ============================================================================
-- EQ VET — mass treatment: one price for the whole herd, any product
--
-- Replaces create_mass_treatment() from 20261009000001:
--   - p_herd_price: the price of the WHOLE herd (all animals together, incl.
--     the medicines). It is split to the cent over the animals' visits; each
--     visit gets one service line (p_price_title) with its share, its
--     medicines are priced 0 (they are inside the herd price), the visit is
--     marked as priced and its notes say what the whole-herd price was.
--     Null = no price yet (price visit by visit as before).
--   - biocides are no longer refused: a visit may use any product.
--
-- Run this AFTER 20261009000001_herds_and_mass_treatment.sql.
-- ============================================================================

drop function if exists "public"."create_mass_treatment"(uuid[], date, text, text, text, text, jsonb);

create or replace function "public"."create_mass_treatment"(
  "p_animal_ids" uuid[],
  "p_visit_date" date,
  "p_vet_name" text,
  "p_reason" text,
  "p_diagnosis" text,
  "p_notes" text,
  "p_items" jsonb,  -- [{ "product_id": uuid, "batch_id": uuid | null, "qty": number (per animal) }]
  "p_herd_price" numeric default null,
  "p_price_title" text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_animals uuid[];
  v_count integer;
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
  v_total_cents bigint;
  v_share_cents bigint;
  v_notes text;
  v_title text;
begin
  select coalesce(array_agg(distinct x), '{}') into v_animals from unnest(p_animal_ids) as x;
  v_count := cardinality(v_animals);
  if v_count = 0 then
    raise exception 'Pasirinkite bent vieną gyvūną.';
  end if;
  if v_count > 500 then
    raise exception 'Vienu metu galima apdoroti iki 500 gyvūnų.';
  end if;
  if p_visit_date is null then
    raise exception 'Įveskite datą.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pridėkite bent vieną produktą.';
  end if;
  if p_herd_price is not null and p_herd_price <= 0 then
    raise exception 'Kaina visai bandai turi būti didesnė už 0.';
  end if;

  -- Every animal must be one of the caller's own (RLS hides the rest).
  if (select count(*) from public.animals a where a.id = any(v_animals) and a.user_id = auth.uid()) <> v_count then
    raise exception 'Kai kurie gyvūnai nerasti.';
  end if;

  -- Validate the products and make sure there is enough stock for the whole group
  -- before anything is written, so the message can name the product.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Kiekis vienam gyvūnui turi būti didesnis už 0.';
    end if;

    select p.id, p.name, p.unit into v_product
    from public.products p where p.id = (v_item->>'product_id')::uuid and p.user_id = auth.uid();
    if not found then
      raise exception 'Produktas nerastas.';
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

    if v_available < v_qty * v_count then
      raise exception 'Nepakanka atsargų produktui "%". Reikia: % %, turima: % %.',
        v_product.name, trim_scale(v_qty * v_count), v_product.unit, trim_scale(v_available), v_product.unit;
    end if;
  end loop;

  v_total_cents := round(p_herd_price * 100);
  v_title := coalesce(nullif(trim(p_price_title), ''), 'Masinis gydymas');
  v_notes := nullif(trim(p_notes), '');
  if p_herd_price is not null then
    v_notes := concat_ws(E'\n', v_notes,
      format('Kaina visai bandai: %s € (%s gyv.), padalinta po lygiai.', replace(to_char(p_herd_price, 'FM999999990.00'), '.', ','), v_count));
  end if;

  foreach v_animal in array v_animals loop
    insert into public.visits (animal_id, visit_date, reason, diagnosis, vet_name, notes)
    values (
      v_animal, p_visit_date,
      nullif(trim(p_reason), ''), nullif(trim(p_diagnosis), ''),
      nullif(trim(p_vet_name), ''), v_notes
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

    if p_herd_price is not null then
      -- The first (total % count) animals carry the odd cent, so the shares add up exactly.
      v_share_cents := v_total_cents / v_count + case when v_visits <= v_total_cents % v_count then 1 else 0 end;
      perform public.save_visit_pricing(
        v_visit,
        jsonb_build_array(jsonb_build_object('title', v_title, 'price', v_share_cents / 100.0)),
        coalesce((select jsonb_agg(jsonb_build_object('id', ui.id, 'markup_percent', null, 'sale_total', 0)) from public.usage_items ui where ui.visit_id = v_visit), '[]'::jsonb),
        true
      );
    end if;
  end loop;

  return jsonb_build_object('visits', v_visits, 'usage_rows', v_rows);
end;
$$;

revoke execute on function "public"."create_mass_treatment"(uuid[], date, text, text, text, text, jsonb, numeric, text) from public, anon;
grant execute on function "public"."create_mass_treatment"(uuid[], date, text, text, text, text, jsonb, numeric, text) to authenticated, service_role;

notify pgrst, 'reload schema';
