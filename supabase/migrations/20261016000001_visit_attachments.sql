-- ============================================================================
-- EQ VET — vizito nuotraukos ir failai
--
-- Photos / PDFs / documents attached to a visit (vizitas). They are shown on
-- the visit card, on the client's card (all of the client's animals, or one
-- animal) and on the animal's own visit history.
--
-- 1. visit_attachments — one row per file; the bytes live in the private
--    storage bucket "visit-files" under {user_id}/{visit_id}/{uuid}.{ext}.
--    animal_id is copied from the visit by a trigger, so "all files of this
--    animal / this client's animals" is one indexed query.
-- 2. Storage policies — each account reads / writes / deletes only objects
--    under its own {user_id}/ folder. Files are shown through short-lived
--    signed URLs, never public ones.
--
-- Deleting a visit removes its attachment rows (cascade); the app removes the
-- stored files first (Supabase storage objects must go through the Storage
-- API, not a SQL delete).
--
-- Run this AFTER 20261010000001_mass_treatment_herd_price.sql.
-- ============================================================================

-- ---- 1. visit_attachments ------------------------------------------------------

create table if not exists "public"."visit_attachments" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "visit_id" uuid not null references "public"."visits"("id") on delete cascade,
  "animal_id" uuid references "public"."animals"("id") on delete set null,
  "storage_path" text not null unique,
  "file_name" text not null check (length(trim("file_name")) > 0),
  "mime_type" text,
  "size_bytes" bigint check ("size_bytes" >= 0),
  "created_at" timestamptz not null default now()
);

comment on table "public"."visit_attachments" is 'Photos / PDFs attached to a visit. File bytes are in storage bucket "visit-files" at storage_path.';
comment on column "public"."visit_attachments"."animal_id" is 'Copied from visits.animal_id (trigger) so files can be listed per animal / per client.';

create index if not exists "idx_visit_attachments_user_id" on "public"."visit_attachments" ("user_id");
create index if not exists "idx_visit_attachments_visit_id" on "public"."visit_attachments" ("visit_id");
create index if not exists "idx_visit_attachments_animal_id" on "public"."visit_attachments" ("animal_id");

-- Fills animal_id from the visit and refuses a visit the caller cannot see
-- (RLS on visits applies — SECURITY INVOKER).
create or replace function "public"."set_visit_attachment_animal"()
returns trigger
language plpgsql
security invoker
as $$
declare
  v_animal uuid;
  v_found boolean;
begin
  select true, v.animal_id into v_found, v_animal from public.visits v where v.id = new.visit_id;
  if v_found is not true then
    raise exception 'Vizitas nerastas.';
  end if;
  new.animal_id := v_animal;
  return new;
end;
$$;

drop trigger if exists "trg_visit_attachments_animal" on "public"."visit_attachments";
create trigger "trg_visit_attachments_animal" before insert on "public"."visit_attachments"
  for each row execute function "public"."set_visit_attachment_animal"();

-- Keeps animal_id right if a visit is ever moved to another animal (or its animal is
-- deleted). SECURITY DEFINER because tenants have no UPDATE grant on
-- visit_attachments; it only mirrors the visit's own animal_id onto that
-- visit's files.
create or replace function "public"."sync_visit_attachment_animal"()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.visit_attachments set animal_id = new.animal_id where visit_id = new.id;
  return new;
end;
$$;

drop trigger if exists "trg_visits_sync_attachment_animal" on "public"."visits";
create trigger "trg_visits_sync_attachment_animal" after update of "animal_id" on "public"."visits"
  for each row when (old.animal_id is distinct from new.animal_id)
  execute function "public"."sync_visit_attachment_animal"();

alter table "public"."visit_attachments" enable row level security;

drop policy if exists "visit_attachments_select_own" on "public"."visit_attachments";
create policy "visit_attachments_select_own" on "public"."visit_attachments"
  for select using (user_id = auth.uid());

-- The file must sit in the caller's own storage folder.
drop policy if exists "visit_attachments_insert_own" on "public"."visit_attachments";
create policy "visit_attachments_insert_own" on "public"."visit_attachments"
  for insert with check (user_id = auth.uid() and split_part(storage_path, '/', 1) = auth.uid()::text);

drop policy if exists "visit_attachments_delete_own" on "public"."visit_attachments";
create policy "visit_attachments_delete_own" on "public"."visit_attachments"
  for delete using (user_id = auth.uid());

revoke all on table "public"."visit_attachments" from anon;
grant select, insert, delete on table "public"."visit_attachments" to authenticated;
grant all on table "public"."visit_attachments" to service_role;

-- ---- 2. storage: private bucket, one folder per account ----------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'visit-files', 'visit-files', false,
  26214400, -- 25 MB per file
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "visit_files_owner_read" on storage.objects;
create policy "visit_files_owner_read" on storage.objects
  for select using (bucket_id = 'visit-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "visit_files_owner_insert" on storage.objects;
create policy "visit_files_owner_insert" on storage.objects
  for insert with check (bucket_id = 'visit-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "visit_files_owner_delete" on storage.objects;
create policy "visit_files_owner_delete" on storage.objects
  for delete using (bucket_id = 'visit-files' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
