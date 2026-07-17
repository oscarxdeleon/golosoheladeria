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
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(_email, '')));
  v_name text := trim(coalesce(_full_name, ''));
  v_encrypted_password text;
  v_stale_user record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tu sesión no está activa. Vuelve a iniciar sesión e intenta de nuevo.';
  END IF;

  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')) THEN
    RAISE EXCEPTION 'Solo administradores o supervisores pueden crear usuarios';
  END IF;

  IF v_email = '' OR position('@' in v_email) <= 1 THEN
    RAISE EXCEPTION 'Ingresa un correo válido para el usuario';
  END IF;

  IF _password IS NULL OR length(_password) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener mínimo 6 caracteres';
  END IF;

  IF v_name = '' OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Ingresa el nombre completo del usuario';
  END IF;

  IF _role <> 'supervisor' AND _branch_id IS NULL THEN
    RAISE EXCEPTION 'Debes asignar una sede para este rol';
  END IF;

  IF _role <> 'supervisor' AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch_id) THEN
    RAISE EXCEPTION 'La sede seleccionada no existe';
  END IF;

  FOR v_stale_user IN
    SELECT id, email
    FROM auth.users
    WHERE lower(email) = v_email
      AND (
        deleted_at IS NOT NULL
        OR banned_until = 'infinity'::timestamptz
        OR COALESCE(raw_app_meta_data, '{}'::jsonb)->>'disabled_by_admin' = 'true'
        OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.users.id)
      )
  LOOP
    PERFORM public.admin_release_deleted_user_email(v_stale_user.id, v_stale_user.email);
  END LOOP;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese correo';
  END IF;

  v_encrypted_password := extensions.crypt(_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token,
    confirmation_sent_at,
    recovery_token,
    recovery_sent_at,
    email_change_token_new,
    email_change,
    email_change_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    phone,
    phone_confirmed_at,
    phone_change,
    phone_change_token,
    phone_change_sent_at,
    email_change_token_current,
    email_change_confirm_status,
    banned_until,
    reauthentication_token,
    reauthentication_sent_at,
    is_sso_user,
    deleted_at,
    is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    v_encrypted_password,
    now(),
    NULL,
    '',
    NULL,
    '',
    NULL,
    '',
    '',
    NULL,
    NULL,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', v_name),
    false,
    now(),
    now(),
    NULL,
    NULL,
    '',
    '',
    NULL,
    '',
    0,
    NULL,
    '',
    NULL,
    false,
    NULL,
    false
  );

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at,
    id,
    email
  ) VALUES (
    v_user_id::text,
    v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    NULL,
    now(),
    now(),
    gen_random_uuid(),
    v_email
  );

  UPDATE public.profiles
  SET
    full_name = v_name,
    email = v_email,
    branch_id = CASE WHEN _role = 'supervisor' THEN NULL ELSE _branch_id END,
    active = COALESCE(_active, true)
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, email, branch_id, active)
    VALUES (
      v_user_id,
      v_name,
      v_email,
      CASE WHEN _role = 'supervisor' THEN NULL ELSE _branch_id END,
      COALESCE(_active, true)
    );
  END IF;

  DELETE FROM public.user_roles WHERE user_id = v_user_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, _role);

  RETURN v_user_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese correo';
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'No se pudo vincular el usuario con la sede o el rol seleccionado';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_app_user(text, text, text, public.app_role, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_app_user(text, text, text, public.app_role, uuid, boolean) TO authenticated;