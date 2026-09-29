-- ============================================================================
-- EQ VET — purchases (Pajamavimas) → Invoice123 expenses
--
-- A purchase document ("invoices" row — supplier invoice from Pajamavimas)
-- can be sent to the tenant's Invoice123 account as an expense (POST
-- /expenses). Same local-first rules as sales invoices:
--   not_sent → sending → sent | failed (safe to retry) | needs_reconcile
--   (outcome unknown — checked against Invoice123 before any retry).
-- Before creating, the server also looks for an expense with the same
-- supplier document number already in Invoice123 (e.g. entered by hand) and
-- links to it instead of creating a duplicate.
--
-- - invoice_items.vat_rate: VAT % per purchase line (expenses need it per line).
-- - invoice123_settings.default_expense_type_id: Invoice123 requires an
--   expense type on every expense line; there is no API to list them, so the
--   options come from the tenant's own existing expenses.
--
-- Run this AFTER 20260928000002_sales_invoices.sql.
-- ============================================================================

alter table "public"."invoices"
  add column if not exists "invoice123_expense_id" text,
  add column if not exists "invoice123_sync_status" text not null default 'not_sent',
  add column if not exists "invoice123_sync_error" text,
  add column if not exists "invoice123_sync_started_at" timestamptz,
  add column if not exists "invoice123_synced_at" timestamptz;

alter table "public"."invoices" drop constraint if exists "invoices_invoice123_sync_status_check";
alter table "public"."invoices" add constraint "invoices_invoice123_sync_status_check"
  check ("invoice123_sync_status" in ('not_sent', 'sending', 'sent', 'failed', 'needs_reconcile'));

alter table "public"."invoices" drop constraint if exists "invoices_user_invoice123_expense_key";
alter table "public"."invoices" add constraint "invoices_user_invoice123_expense_key"
  unique ("user_id", "invoice123_expense_id");

comment on column "public"."invoices"."invoice123_sync_status" is 'Purchase → Invoice123 expense: not_sent → sending → sent | failed | needs_reconcile. Written only by the server.';

alter table "public"."invoice_items" add column if not exists "vat_rate" numeric(5, 2);

comment on column "public"."invoice_items"."vat_rate" is 'VAT % of this purchase line (0, 5, 9, 21...). unit_price / total_price are net (be PVM).';

alter table "public"."invoice123_settings"
  add column if not exists "default_expense_type_id" text,
  add column if not exists "default_expense_type_name" text;

-- Purchase sync status is server-owned: stop the browser from faking "sent".
-- A column-level REVOKE is a no-op while a table-wide UPDATE grant exists, so
-- drop UPDATE entirely and re-grant it for the original purchase columns only.
revoke update on table "public"."invoices" from authenticated;
grant update (
  "invoice_number", "invoice_date", "supplier_id", "supplier_name", "supplier_code", "supplier_vat",
  "currency", "total_net", "total_vat", "total_gross", "pdf_filename"
) on table "public"."invoices" to authenticated;

notify pgrst, 'reload schema';
