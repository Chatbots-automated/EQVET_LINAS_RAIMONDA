-- ============================================================================
-- EQ VET — per-tenant accent theme
--
-- Two vets share this project but each account can carry its own visual
-- accent (e.g. matching a vet's own logo) without affecting the other's
-- account. 'default' keeps the current teal/emerald look; other values are
-- looked up against a small static preset table in the frontend
-- (src/lib/theme.tsx) — this column is just a label, not styling itself.
--
-- Run this AFTER 20260918000002_client_entity_fields_and_branding.sql.
-- ============================================================================

alter table "public"."profiles" add column if not exists "theme" text not null default 'default';

comment on column "public"."profiles"."theme" is 'Accent theme key for this account, matched against presets in src/lib/theme.tsx. "default" = standard teal/emerald look.';
