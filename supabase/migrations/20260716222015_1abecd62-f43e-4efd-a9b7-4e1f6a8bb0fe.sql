CREATE OR REPLACE FUNCTION public.admin_update_app_user(
  _user_id uuid,
  _full_name text DEFAULT NULL,
  _role public.app_role DEFAULT NULL,
  _branch_id uuid DEFAULT NULL,
  _branch_id_set boolean DEFAULT false,
  _active boolean DEFAULT NULL,
  _password text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')) THEN
    RAISE EXCEPTION 'Solo administradores o supervisores pueden gestionar usuarios';
  END IF;

  UPDATE public.profiles
  SET
    full_name = COALESCE(_full_name, full_name),
    branch_id = CASE WHEN _branch_id_set THEN _branch_id ELSE branch_id END,
    active    = COALESCE(_active, active)
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el usuario seleccionado';
  END IF;

  IF _role IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _user_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  END IF;

  IF _password IS NOT NULL AND length(_password) >= 6 THEN
    UPDATE auth.users
    SET
      encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')),
      updated_at = now()
    WHERE id = _user_id;

    UPDATE public.tablet_devices
    SET user_password = _password
    WHERE user_id = _user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_app_user(uuid, text, public.app_role, uuid, boolean, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_app_user(uuid, text, public.app_role, uuid, boolean, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_app_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')) THEN
    RAISE EXCEPTION 'Solo administradores o supervisores pueden eliminar usuarios';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio usuario';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'No se encontró el usuario seleccionado';
  END IF;

  DELETE FROM public.tablet_devices WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;
  DELETE FROM auth.users WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_app_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_app_user(uuid) TO authenticated;