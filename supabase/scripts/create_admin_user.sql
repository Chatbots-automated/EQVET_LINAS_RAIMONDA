-- ============================================================================
-- EQ VET — create the admin account (sees both farms)
--
-- Run this AFTER all three migrations in supabase/migrations/ have been applied
-- (it needs profiles.is_admin from 20260916000003_admin_access.sql).
--
-- NOTE: Supabase officially recommends creating Auth users via the Dashboard
-- (Authentication → Users → Add user) or the Admin API, not raw SQL — the
-- auth.users/auth.identities shape is an internal implementation detail that
-- can change between GoTrue versions. This works on the current schema, but
-- if login fails afterwards, delete the user from the Dashboard and re-add it
-- there instead (then just run the final UPDATE statement below to flag it
-- admin).
-- ============================================================================

do $$
declare
  v_user_id uuid;
  v_email text := 'gratasgedraitis@gmail.com';
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
    jsonb_build_object('full_name', 'Gratas Gedraitis'),
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

-- handle_new_user() already created the profiles row — just flag it admin.
update public.profiles
set is_admin = true, full_name = 'Gratas Gedraitis'
where email = 'gratasgedraitis@gmail.com';
