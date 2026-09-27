-- ============================================================================
-- EQ VET — Invoice123 client sync (via n8n)
--
-- - clients get external_source/external_id so a row imported from
--   Invoice123 can be matched again on every sync (upsert, no duplicates).
--   Manually created clients keep both NULL.
-- - clients.country_code (Invoice123 sends it; clients can be NL/DE/US).
-- - sync_invoice123_clients(p_owner_email, p_clients): the single entry
--   point n8n calls. p_owner_email picks the tenant (e.g. Linas's account),
--   so each vet's Invoice123 clients land only under their own user_id.
--   Callable ONLY with the service_role key — never by a logged-in vet,
--   otherwise one vet could write into the other's tenant.
--
-- Run this AFTER 20260925000002_biocide_usage_and_journals.sql.
-- ============================================================================

alter table "public"."clients"
  add column if not exists "country_code" text,
  add column if not exists "external_source" text,
  add column if not exists "external_id" text,
  add column if not exists "synced_at" timestamptz;

comment on column "public"."clients"."external_source" is 'Where the client was imported from (e.g. ''invoice123''). NULL = created manually in the app.';
comment on column "public"."clients"."external_id" is 'Client id in the external system (Invoice123 "id"). Unique per user + source.';

-- NULLs are distinct, so manual clients (NULL source/id) never collide.
alter table "public"."clients" drop constraint if exists "clients_user_external_key";
alter table "public"."clients"
  add constraint "clients_user_external_key" unique ("user_id", "external_source", "external_id");

-- ---- sync function --------------------------------------------------------

create or replace function "public"."sync_invoice123_clients"(p_owner_email text, p_clients jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_inserted int := 0;
  v_updated int := 0;
  c jsonb;
  v_code text;
  v_vat text;
  v_was_insert boolean;
begin
  select id into v_user_id from public.profiles where lower(email) = lower(trim(p_owner_email));
  if v_user_id is null then
    raise exception 'No EQ VET account with email %', p_owner_email;
  end if;

  if jsonb_typeof(p_clients) <> 'array' then
    raise exception 'p_clients must be a JSON array of Invoice123 clients';
  end if;

  for c in select * from jsonb_array_elements(p_clients)
  loop
    -- Invoice123 uses "-" / "" as "no code".
    v_code := nullif(nullif(trim(c->>'code'), '-'), '');
    v_vat := nullif(nullif(trim(c->>'vat_code'), '-'), '');

    insert into public.clients as cl (
      user_id, external_source, external_id, name, address, country_code,
      is_company, company_code, vat_code, synced_at
    ) values (
      v_user_id, 'invoice123', c->>'id', trim(c->>'name'), nullif(trim(c->>'address'), ''),
      nullif(upper(trim(c->>'country_code')), ''),
      (v_code is not null or v_vat is not null), v_code, v_vat, now()
    )
    on conflict (user_id, external_source, external_id) do update set
      name = excluded.name,
      address = excluded.address,
      country_code = excluded.country_code,
      is_company = excluded.is_company,
      company_code = excluded.company_code,
      vat_code = excluded.vat_code,
      synced_at = excluded.synced_at
      -- phone / email / notes are app-only fields — never overwritten.
    returning (xmax = 0) into v_was_insert;

    if v_was_insert then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('user_id', v_user_id, 'inserted', v_inserted, 'updated', v_updated);
end;
$$;

comment on function "public"."sync_invoice123_clients"(text, jsonb) is 'Upserts Invoice123 clients (the data.result array) into the tenant owning p_owner_email. service_role only — called from n8n.';

revoke execute on function "public"."sync_invoice123_clients"(text, jsonb) from public, anon, authenticated;
grant execute on function "public"."sync_invoice123_clients"(text, jsonb) to service_role;
