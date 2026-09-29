-- ============================================================================
-- EQ VET — Invoice123 (Sąskaita123) integration: per-tenant configuration
--
-- One integration codebase, one row of configuration per tenant. The tenant
-- boundary is the same as everywhere else in this project: user_id =
-- auth.uid() (see 20260916000002). No organization table is introduced.
--
-- - invoice123_settings: defaults (series, unit, bank, VAT...) + a cached copy
--   of the options fetched from Invoice123, so invoice creation never has to
--   re-fetch /series, /units, /banks... Readable/writable by its own tenant.
-- - invoice123_credentials: the tenant's API token, AES-256-GCM encrypted by
--   the Next.js server (key in INVOICE123_TOKEN_ENCRYPTION_KEY). RLS enabled
--   with NO policies and no grants to anon/authenticated — only service_role
--   (server-side code) can read or write it. The browser never sees it, not
--   even encrypted.
--
-- Run this AFTER 20260927000001_invoice123_clients.sql.
-- ============================================================================

-- ---- settings ---------------------------------------------------------------

create table if not exists "public"."invoice123_settings" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "enabled" boolean not null default false,

  "default_series_id" text,
  "default_series_title" text,
  "default_unit_id" text,
  "default_unit_name" text,
  "default_activity_id" text,
  "default_activity_name" text,
  "default_bank_id" text,
  "default_bank_name" text,
  "default_vat_id" text,
  "default_language" text not null default 'lt',
  "default_country_code" text not null default 'LT',
  "default_payment_term_days" integer not null default 30 check ("default_payment_term_days" between 0 and 365),
  "issued_by" text,

  "company_vat_enabled" boolean,
  "company_vat_status" text,

  "remote_options" jsonb,
  "last_config_sync_at" timestamptz,
  "last_connection_ok_at" timestamptz,
  "last_error" text,

  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now(),

  constraint "invoice123_settings_user_key" unique ("user_id")
);

comment on table "public"."invoice123_settings" is 'Per-tenant Invoice123 configuration. Exactly one row per user_id. The API token is NOT here — see invoice123_credentials.';
comment on column "public"."invoice123_settings"."remote_options" is 'Cached Invoice123 option lists (series, units, vats, banks, activities, cash_registers, company) from the last configuration sync.';
comment on column "public"."invoice123_settings"."issued_by" is 'Name printed as "Sąskaitą išrašė" on this tenant''s invoices.';

drop trigger if exists "trg_invoice123_settings_updated_at" on "public"."invoice123_settings";
create trigger "trg_invoice123_settings_updated_at" before update on "public"."invoice123_settings"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."invoice123_settings" enable row level security;

-- Deliberately NO is_admin() bypass: an Invoice123 configuration drives real
-- invoices in a real accounting account, so it stays strictly own-tenant.
drop policy if exists "invoice123_settings_select_own" on "public"."invoice123_settings";
create policy "invoice123_settings_select_own" on "public"."invoice123_settings"
  for select using (user_id = auth.uid());

drop policy if exists "invoice123_settings_insert_own" on "public"."invoice123_settings";
create policy "invoice123_settings_insert_own" on "public"."invoice123_settings"
  for insert with check (user_id = auth.uid());

drop policy if exists "invoice123_settings_update_own" on "public"."invoice123_settings";
create policy "invoice123_settings_update_own" on "public"."invoice123_settings"
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "invoice123_settings_delete_own" on "public"."invoice123_settings";
create policy "invoice123_settings_delete_own" on "public"."invoice123_settings"
  for delete using (user_id = auth.uid());

revoke all on table "public"."invoice123_settings" from anon;
grant select, insert, update, delete on table "public"."invoice123_settings" to authenticated;
grant all on table "public"."invoice123_settings" to service_role;

-- ---- credentials (service_role only) ----------------------------------------

create table if not exists "public"."invoice123_credentials" (
  "user_id" uuid primary key references "auth"."users"("id") on delete cascade,
  "token_ciphertext" text not null,
  "token_hint" text not null,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz not null default now()
);

comment on table "public"."invoice123_credentials" is 'Encrypted Invoice123 API token per tenant. service_role only — no RLS policies, no grants to anon/authenticated.';
comment on column "public"."invoice123_credentials"."token_ciphertext" is 'AES-256-GCM, format v1:<iv b64>:<tag b64>:<ciphertext b64>. Key lives only in the server env (INVOICE123_TOKEN_ENCRYPTION_KEY).';
comment on column "public"."invoice123_credentials"."token_hint" is 'Last 4 characters of the token, for "••••abcd" display. Never the full token.';

drop trigger if exists "trg_invoice123_credentials_updated_at" on "public"."invoice123_credentials";
create trigger "trg_invoice123_credentials_updated_at" before update on "public"."invoice123_credentials"
  for each row execute function "public"."touch_updated_at"();

alter table "public"."invoice123_credentials" enable row level security;

revoke all on table "public"."invoice123_credentials" from anon, authenticated;
grant all on table "public"."invoice123_credentials" to service_role;

notify pgrst, 'reload schema';
