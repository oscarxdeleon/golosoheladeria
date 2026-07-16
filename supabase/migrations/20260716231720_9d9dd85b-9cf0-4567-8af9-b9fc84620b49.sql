CREATE OR REPLACE FUNCTION public.admin_delete_app_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_has_history boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.sales WHERE user_id = _user_id OR delivery_user_id = _user_id OR cancelled_by = _user_id
    UNION ALL SELECT 1 FROM public.cash_sessions WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.cash_deposits WHERE user_id = _user_id OR voided_by = _user_id
    UNION ALL SELECT 1 FROM public.expenses WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.purchases WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.inventory_movements WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.table_events WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.waiter_calls WHERE attended_by = _user_id
    UNION ALL SELECT 1 FROM public.branch_detection_log WHERE user_id = _user_id
    UNION ALL SELECT 1 FROM public.attendance_employees WHERE profile_id = _user_id
  ) INTO v_has_history;

  DELETE FROM public.tablet_devices WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;

  IF v_has_history THEN
    UPDATE public.profiles
    SET active = false,
        full_name = CASE WHEN full_name ILIKE '%(eliminado)%' THEN full_name ELSE full_name || ' (eliminado)' END
    WHERE id = _user_id;

    UPDATE auth.users
    SET banned_until = 'infinity',
        updated_at = now(),
        raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('disabled_by_admin', true)
    WHERE id = _user_id;
  ELSE
    DELETE FROM public.profiles WHERE id = _user_id;
    DELETE FROM auth.users WHERE id = _user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_app_user(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_app_user(uuid) TO authenticated;