CREATE OR REPLACE FUNCTION public.move_table(_from_table_id uuid, _to_table_id uuid, _reason text DEFAULT NULL::text, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _from public.restaurant_tables;
  _to public.restaurant_tables;
  _sale_id uuid;
  _moved_ids uuid[];
  _moved_count int := 0;
  _user_name text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Mover mesas: permitido a admin, supervisor, cajero y mesero.
  IF NOT (
    public.has_role(_user_id,'admin') OR
    public.has_role(_user_id,'supervisor') OR
    public.has_role(_user_id,'cajero') OR
    public.has_role(_user_id,'mesero')
  ) THEN
    RAISE EXCEPTION 'ROLE_FORBIDDEN: No tienes permiso para mover mesas.';
  END IF;

  SELECT * INTO _from FROM public.restaurant_tables WHERE id = _from_table_id FOR UPDATE;
  SELECT * INTO _to FROM public.restaurant_tables WHERE id = _to_table_id FOR UPDATE;
  IF _from.id IS NULL OR _to.id IS NULL THEN RAISE EXCEPTION 'Mesa no encontrada'; END IF;
  IF _from.id = _to.id THEN RAISE EXCEPTION 'La mesa destino es la misma que la origen'; END IF;
  IF _from.branch_id <> _to.branch_id THEN RAISE EXCEPTION 'Las mesas deben pertenecer a la misma sede'; END IF;
  IF _to.status = 'occupied' AND NOT _force THEN
    RAISE EXCEPTION 'destination_occupied';
  END IF;

  WITH updated AS (
    UPDATE public.sales SET table_id = _to.id
     WHERE table_id = _from.id AND COALESCE(status,'pending') = 'pending'
     RETURNING id
  )
  SELECT array_agg(id) INTO _moved_ids FROM updated;

  _moved_count := COALESCE(array_length(_moved_ids, 1), 0);
  _sale_id := CASE WHEN _moved_count > 0 THEN _moved_ids[1] ELSE NULL END;

  UPDATE public.restaurant_tables SET
    status = 'occupied',
    current_guests = COALESCE(_to.current_guests, _from.current_guests),
    occupied_at = COALESCE(_to.occupied_at, _from.occupied_at, now())
  WHERE id = _to.id;

  UPDATE public.restaurant_tables SET
    status = 'free', current_guests = NULL, occupied_at = NULL
  WHERE id = _from.id;

  SELECT COALESCE(full_name, 'Usuario') INTO _user_name FROM public.profiles WHERE id = _user_id;

  INSERT INTO public.table_events(event_type, table_id, table_number, target_table_id, target_table_number,
    branch_id, user_id, user_name, reason, previous_status, new_status, sale_id)
  VALUES ('move', _from.id, _from.number, _to.id, _to.number, _from.branch_id, _user_id, _user_name,
    _reason, _from.status, 'free', _sale_id);

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'moved_count', _moved_count);
END;
$function$;