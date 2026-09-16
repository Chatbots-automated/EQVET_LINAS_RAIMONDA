-- ============================================================================
-- EQ VET — supplier bank/address fields
--
-- The invoice-OCR webhook (n8n) returns supplier.iban and supplier.address;
-- store them instead of discarding on import.
--
-- Run this AFTER 20260917000001_clients_and_packaging.sql.
-- ============================================================================

alter table "public"."suppliers" add column if not exists "iban" text;
alter table "public"."suppliers" add column if not exists "address" text;
