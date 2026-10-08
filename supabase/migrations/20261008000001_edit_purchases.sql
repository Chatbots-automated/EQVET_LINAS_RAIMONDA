-- ============================================================================
-- EQ VET — editing / removing received purchases (Pajamavimas)
--
-- A mis-read supplier invoice (wrong quantity, unit, product, price...) must be
-- fixable after it was confirmed. Batches are the stock ledger and feed the
-- legal journals, so the rules live in the database, not only in the UI:
--
-- 1. Changing batches.received_qty moves qty_left by the same amount, so what
--    was already used (nurašyta) stays used. Going below the used amount is
--    refused.
-- 2. A batch that was already used keeps its product and unit — usage_items,
--    journals and the visit history point at it.
-- 3. A batch that was already used cannot be deleted (batches → usage_items is
--    ON DELETE CASCADE, so it would silently erase visit/journal history).
-- 4. delete_purchase_document() removes a purchase document together with its
--    (unused) batches in ONE transaction.
-- 5. The automatic medical-waste row follows received_qty / package_count /
--    product edits too, not just qty_left.
--
-- Run this AFTER 20260930000003_journals_waste_password.sql.
-- ============================================================================

-- ---- 1 + 2. keep the ledger balanced on edit ---------------------------------

create or replace function "public"."adjust_batch_on_edit"()
returns trigger
language plpgsql
as $$
declare
  v_used numeric := old.received_qty - coalesce(old.qty_left, old.received_qty);
begin
  if v_used > 0 and (new.product_id is distinct from old.product_id or new.unit is distinct from old.unit) then
    raise exception 'Panaudotos partijos produkto ir mato vieneto keisti negalima (jau nurašyta: % %).', v_used, old.unit;
  end if;

  if new.received_qty is distinct from old.received_qty then
    if new.received_qty < v_used then
      raise exception 'Gautas kiekis (%) negali būti mažesnis už jau panaudotą kiekį (% %).', new.received_qty, v_used, old.unit;
    end if;
    new.qty_left := new.received_qty - v_used;
    new.status := case
      when new.qty_left <= 0 then 'depleted'
      when old.status = 'depleted' then 'active'
      else new.status
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists "trg_adjust_batch_on_edit" on "public"."batches";
create trigger "trg_adjust_batch_on_edit" before update on "public"."batches"
  for each row execute function "public"."adjust_batch_on_edit"();

-- ---- 3. a used batch cannot be deleted ---------------------------------------

create or replace function "public"."block_used_batch_delete"()
returns trigger
language plpgsql
as $$
begin
  -- Deleted by a foreign-key cascade (removing a product or the whole account):
  -- that is an intentional wipe, not a user removing one purchase.
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if old.received_qty - coalesce(old.qty_left, old.received_qty) > 0 then
    raise exception 'Partija jau panaudota (nurašyta), todėl jos pašalinti negalima.';
  end if;

  return old;
end;
$$;

drop trigger if exists "trg_block_used_batch_delete" on "public"."batches";
create trigger "trg_block_used_batch_delete" before delete on "public"."batches"
  for each row execute function "public"."block_used_batch_delete"();

-- ---- 4. remove a purchase document with its batches ---------------------------

create or replace function "public"."delete_purchase_document"("p_invoice_id" uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_status text;
begin
  select invoice123_sync_status into v_status from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Dokumentas nerastas.';
  end if;
  if v_status = 'sending' then
    raise exception 'Dokumentas šiuo metu siunčiamas į Sąskaita123 — palaukite arba patikrinkite jo būseną.';
  end if;

  -- The batch guard above refuses (and rolls everything back) if any was used.
  delete from public.batches where invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id; -- invoice_items cascade
end;
$$;

revoke execute on function "public"."delete_purchase_document"(uuid) from public, anon;
grant execute on function "public"."delete_purchase_document"(uuid) to authenticated, service_role;

-- ---- 5. waste row follows quantity / package / product edits -----------------

drop trigger if exists "trg_sync_batch_medical_waste" on "public"."batches";
create trigger "trg_sync_batch_medical_waste"
  after update of "qty_left", "received_qty", "package_count", "product_id" on "public"."batches"
  for each row execute function "public"."sync_batch_medical_waste"();

notify pgrst, 'reload schema';
