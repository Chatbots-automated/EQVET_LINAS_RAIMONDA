-- ============================================================================
-- EQ VET — create Raimonda's and Linas's accounts
--
-- Each becomes its own fully isolated tenant (RLS keys everything off
-- auth.uid() = user_id) — neither sees the other's data. No is_admin flag
-- here, unlike the earlier admin-account script.
--
-- Run this AFTER all migrations in supabase/migrations/ have been applied.
--
-- Same caveat as create_admin_user.sql: raw-inserting into auth.users /
-- auth.identities isn't Supabase's officially supported path (Dashboard →
-- Add User is) — the schema is an internal implementation detail. Works on
-- the current schema; if login fails for either account afterward, delete
-- that user from the Dashboard and re-add it there instead.
-- ============================================================================

do $$
declare
  v_user_id uuid;
  v_email text := 'mbeqvet@gmail.com';
  v_password text := '123456';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Raimonda Tamulionytė-Skerė'),
    now(), now(),
    '', '', '', ''
  )
  returning id into v_user_id;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );
end $$;

do $$
declare
  v_user_id uuid;
  v_email text := 'eqvetlinas@gmail.com';
  v_password text := '123456';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Linas'),
    now(), now(),
    '', '', '', ''
  )
  returning id into v_user_id;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );
end $$;
