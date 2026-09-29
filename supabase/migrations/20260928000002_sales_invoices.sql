-- ============================================================================
-- EQ VET — sales invoices issued through Invoice123 (Sąskaita123)
--
-- Named sales_* on purpose: "invoices" / "invoice_items" already exist and
-- hold SUPPLIER purchase invoices (Pajamavimas).
--
-- - sales_invoices: local record of every invoice, created BEFORE calling
--   Invoice123 (status 'creating') so a crash/timeout never loses track of
--   an invoice that may have been issued. Keeps a client + line snapshot so
--   history survives Invoice123 outages and later price changes.
--   Invoice123 stays the authority for the official number (series_title +
--   series_number) — GVET only stores what it returns.
-- - sales_invoice_items / sales_invoice_payments: line and payment snapshots.
-- - invoice123_audit_log: who did what, when, with what result. No tokens.
-- - storage bucket "invoice-pdfs" (private): issued PDFs, {user_id}/{id}.pdf.
--
-- Security model: tenants (user_id) can only SELECT their own rows. There are
-- no insert/update/delete grants for authenticated at all — every write goes
-- through the Next.js server (service_role, tenant resolved from the verified
-- session), so invoice / payment state can't be forged from the browser.
-- No is_admin() bypass: financial data stays strictly own-tenant.
--
-- Run this AFTER 20260928000001_invoice123_settings.sql.
-- ============================================================================

-- ---- sales_invoices -----------------------------------------------------------

create table if not exists "public"."sales_invoices" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "client_id" uuid references "public"."clients"("id") on delete set null,
  "visit_id" uuid references "public"."visits"("id") on delete set null,
  "animal_id" uuid references "public"."animals"("id") on delete set null,

  "source" text not null default 'gvet' check ("source" in ('gvet', 'invoice123_import')),
  "idempotency_key" uuid,
  "status" text not null check ("status" in ('creating', 'created', 'failed', 'needs_reconcile')),
  "creation_started_at" timestamptz,
  "sync_error" text,

  "invoice123_invoice_id" text,
  "invoice123_client_id" text,
  "series_title" text,
  "series_number" integer,
  "invoice_type" text not null default 'simple',

  "date" date not null,
  "date_due" date,
  "subtotal" numeric(12, 2) not null default 0,
  "vat_total" numeric(12, 2) not null default 0,
  "total" numeric(12, 2) not null,
  "paid_total" numeric(12, 2) not null default 0,
  "payment_status" text not null default 'unpaid' check ("payment_status" in ('unpaid', 'partial', 'paid', 'overpaid')),
  "invoice123_paid" boolean,
  "currency_code" text not null default 'EUR',
  "language" text not null default 'lt',
  "issued_by" text,

  "client_name" text not null,
  "client_code" text,
  "client_vat_code" text,
  "client_address" text,
  "client_country_code" text,

  "pdf_storage_path" text,

  "created_by" uuid references "auth"."users"("id") on delete set null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),

  constraint "sales_invoices_user_idempotency_key" unique ("user_id", "idempotency_key"),
  constraint "sales_invoices_user_invoice123_key" unique ("user_id", "invoice123_invoice_id")
);

comment on table "public"."sales_invoices" is 'Sales invoices issued via Invoice123. Local-first: row exists (status creating) before the API call. Invoice123 is the authority for series_title/series_number.';
comment on column "public"."sales_invoices"."idempotency_key" is 'Generated once per draft in the browser; a double-click/refresh/retry with the same key can never create a second invoice.';
comment on column "public"."sales_invoices"."status" is 'creating → created | failed (definitely not created, safe to retry) | needs_reconcile (outcome unknown, e.g. timeout — must be checked against Invoice123 before any retry).';

create index if not exists "idx_sales_invoices_user_id" on "public"."sales_invoices" ("user_id");
create index if not exists "idx_sales_invoices_client_id" on "public"."sales_invoices" ("client_id");
create index if not exists "idx_sales_invoices_visit_id" on "public"."sales_invoices" ("visit_id");
create index if not exists "idx_sales_invoices_date" on "public"."sales_invoices" ("date");

drop trigger if exists "trg_sales_invoices_updated_at" on "public"."sales_invoices";
create trigger "trg_sales_invoices_updated_at" before update on "public"."sales_invoices"
  for each row execute function "public"."touch_updated_at"();

-- ---- sales_invoice_items --------------------------------------------------------

create table if not exists "public"."sales_invoice_items" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "invoice_id" uuid not null references "public"."sales_invoices"("id") on delete cascade,
  "position" integer not null default 0,
  "title" text not null,
  "description" text,
  "quantity" numeric(12, 3) not null,
  "unit_price" numeric(14, 4) not null,
  "line_total" numeric(12, 2) not null,
  "unit_name" text,
  "product_id" uuid references "public"."products"("id") on delete set null,
  "created_at" timestamptz not null default now()
);

comment on table "public"."sales_invoice_items" is 'Immutable line snapshot of an issued invoice — never re-rendered from current product prices.';

create index if not exists "idx_sales_invoice_items_invoice_id" on "public"."sales_invoice_items" ("invoice_id");
create index if not exists "idx_sales_invoice_items_user_id" on "public"."sales_invoice_items" ("user_id");

-- ---- sales_invoice_payments -----------------------------------------------------

create table if not exists "public"."sales_invoice_payments" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null default auth.uid() references "auth"."users"("id") on delete cascade,
  "invoice_id" uuid not null references "public"."sales_invoices"("id") on delete cascade,
  "idempotency_key" uuid,
  "invoice123_payment_id" text,
  "payment_type" text not null check ("payment_type" in ('transfer', 'cash', 'refund', 'other')),
  "amount" numeric(12, 2) not null,
  "payment_date" date not null,
  "status" text not null check ("status" in ('pending', 'synced', 'failed')),
  "sync_error" text,
  "created_by" uuid references "auth"."users"("id") on delete set null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),

  constraint "sales_invoice_payments_user_idempotency_key" unique ("user_id", "idempotency_key"),
  constraint "sales_invoice_payments_user_invoice123_key" unique ("user_id", "invoice123_payment_id")
);

create index if not exists "idx_sales_invoice_payments_invoice_id" on "public"."sales_invoice_payments" ("invoice_id");
create index if not exists "idx_sales_invoice_payments_user_id" on "public"."sales_invoice_payments" ("user_id");

drop trigger if exists "trg_sales_invoice_payments_updated_at" on "public"."sales_invoice_payments";
create trigger "trg_sales_invoice_payments_updated_at" before update on "public"."sales_invoice_payments"
  for each row execute function "public"."touch_updated_at"();

-- ---- invoice123_audit_log ---------------------------------------------------------

create table if not exists "public"."invoice123_audit_log" (
  "id" uuid default gen_random_uuid() primary key,
  "user_id" uuid not null references "auth"."users"("id") on delete cascade,
  "actor_id" uuid references "auth"."users"("id") on delete set null,
  "action" text not null,
  "entity_type" text,
  "entity_id" text,
  "result" text not null check ("result" in ('ok', 'error')),
  "details" jsonb,
  "created_at" timestamptz not null default now()
);

comment on table "public"."invoice123_audit_log" is 'Financial action trail (invoice_created, payment_created, client_created_invoice123, ...). Never contains API tokens.';

create index if not exists "idx_invoice123_audit_log_user_id" on "public"."invoice123_audit_log" ("user_id", "created_at" desc);

-- ---- RLS: own-tenant SELECT only; writes are server-side (service_role) -------

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'sales_invoices', 'sales_invoice_items', 'sales_invoice_payments', 'invoice123_audit_log'
  ])
  loop
    execute format('alter table "public".%I enable row level security', t);

    execute format('drop policy if exists "%1$s_select_own" on "public".%1$I', t);
    execute format(
      'create policy "%1$s_select_own" on "public".%1$I for select using (user_id = auth.uid())',
      t
    );

    execute format('revoke all on table "public".%I from anon, authenticated', t);
    execute format('grant select on table "public".%I to authenticated', t);
    execute format('grant all on table "public".%I to service_role', t);
  end loop;
end $$;

-- ---- storage: issued PDFs (private, service_role only) ---------------------------

insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', false)
on conflict (id) do nothing;

-- No storage.objects policies for this bucket: only the server (service_role)
-- reads/writes it, always under the {user_id}/ prefix of the verified tenant,
-- and streams PDFs to the browser after an ownership check.

notify pgrst, 'reload schema';
