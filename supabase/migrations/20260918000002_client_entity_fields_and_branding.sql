-- ============================================================================
-- EQ VET — client feedback round 1
--
-- - clients: support juridinis asmuo (legal entity) — company code + VAT
--   code, shown when is_company is checked. (email already existed.)
-- - animals.species default switches from 'bovine' to 'equine' — this
--   practice is horse/dog/cat focused, not livestock.
-- - profiles.logo_url + a "logos" storage bucket so each vet can have their
--   own branding shown in the app (per-user, since two unrelated vets share
--   this project).
--
-- Run this AFTER 20260918000001_administration_routes.sql.
-- ============================================================================

alter table "public"."clients"
  add column if not exists "is_company" boolean not null default false,
  add column if not exists "company_code" text,
  add column if not exists "vat_code" text;

comment on column "public"."clients"."is_company" is 'True if this client is a juridinis asmuo (legal entity) rather than a private person.';

alter table "public"."animals" alter column "species" set default 'equine';

alter table "public"."profiles" add column if not exists "logo_url" text;

comment on column "public"."profiles"."logo_url" is 'Public URL of this vet''s own logo (storage bucket "logos"), shown in the app shell for their account only.';

-- ---- storage: per-user logo uploads ---------------------------------------

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "logos_public_read" on storage.objects;
create policy "logos_public_read" on storage.objects
  for select using (bucket_id = 'logos');

drop policy if exists "logos_owner_write" on storage.objects;
create policy "logos_owner_write" on storage.objects
  for insert with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "logos_owner_update" on storage.objects;
create policy "logos_owner_update" on storage.objects
  for update using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "logos_owner_delete" on storage.objects;
create policy "logos_owner_delete" on storage.objects
  for delete using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

comment on policy "logos_owner_write" on storage.objects is 'A vet may only upload logo files under their own {user_id}/... folder in the logos bucket.';
