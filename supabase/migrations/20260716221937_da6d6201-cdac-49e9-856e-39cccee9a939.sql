CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.admin_create_app_user(
  _email text,
  _password text,
  _full_name text,
  _role public.app_role,
  _branch_id uuid DEFAULT NULL,
  _active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email text := lower(trim(_email));
  v_name text := trim(_full_name);
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')) THEN
    RAISE EXCEPTION 'Solo administradores o supervisores pueden crear usuarios';
  END IF;

  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) <= 1 THEN
    RAISE EXCEPTION 'Ingresa un correo válido para el usuario';
  END IF;

  IF _password IS NULL OR length(_password) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener mínimo 6 caracteres';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Ingresa el nombre completo del usuario';
  END IF;

  IF _role <> 'supervisor' AND _branch_id IS NULL THEN
    RAISE EXCEPTION 'Debes asignar una sede para este rol';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Ya existe un usuario con este correo';
  END IF;

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(_password, extensions.gen_salt('bf')),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', v_name),
    now(),
    now(),
    false,
    false
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at,
    email
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', false, 'phone_verified', false),
    'email',
    NULL,
    now(),
    now(),
    v_email
  );

  INSERT INTO public.profiles (id, full_name, email, branch_id, active)
  VALUES (v_user_id, v_name, v_email, CASE WHEN _role = 'supervisor' THEN NULL ELSE _branch_id END, COALESCE(_active, true))
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    branch_id = EXCLUDED.branch_id,
    active = EXCLUDED.active;

  DELETE FROM public.user_roles WHERE user_id = v_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, _role);

  RETURN v_user_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un usuario con este correo';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_app_user(text, text, text, public.app_role, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_app_user(text, text, text, public.app_role, uuid, boolean) TO authenticated;