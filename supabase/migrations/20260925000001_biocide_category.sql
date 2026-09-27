-- ============================================================================
-- EQ VET — "Biocidai" product category
--
-- Kept in its own file on purpose: Postgres refuses to *use* a freshly added
-- enum value inside the same transaction that added it, and the Supabase SQL
-- Editor runs a whole pasted file as one transaction. Run this file on its
-- own, then 20260925000002_biocide_usage_and_journals.sql.
--
-- Run this AFTER 20260918000003_profile_theme.sql.
-- ============================================================================

alter type "public"."product_category" add value if not exists 'biocides';
