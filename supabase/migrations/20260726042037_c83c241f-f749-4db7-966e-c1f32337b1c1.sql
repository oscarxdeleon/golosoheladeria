CREATE OR REPLACE FUNCTION public.admin_update_app_user(_user_id uuid, _full_name text DEFAULT NULL::text, _role app_role DEFAULT NULL::app_role, _branch_id uuid DEFAULT NULL::uuid, _branch_id_set boolean DEFAULT false, _active boolean DEFAULT NULL::boolean, _password text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
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
    SET password = _password
    WHERE user_id = _user_id;
  END IF;
END;
$function$;