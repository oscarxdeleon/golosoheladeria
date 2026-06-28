
-- 1) abrirCaja: rechaza si ya hay una abierta para el usuario
CREATE OR REPLACE FUNCTION public.open_cash_session(
  _opening_amount numeric,
  _opening_notes  text DEFAULT NULL,
  _user_name      text DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _existing public.cash_sessions;
  _session public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para abrir caja';
  END IF;

  IF _opening_amount IS NULL OR _opening_amount < 0 THEN
    RAISE EXCEPTION 'El monto inicial debe ser mayor o igual a cero';
  END IF;

  -- Lock por usuario para evitar dobles aperturas concurrentes
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  -- Si ya hay una abierta, devolverla (idempotente para el frontend)
  SELECT * INTO _existing
  FROM public.cash_sessions
  WHERE user_id = _user_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.cash_sessions (user_id, user_name, opening_amount, opening_notes, status)
  VALUES (
    _user_id,
    COALESCE(NULLIF(trim(_user_name), ''), 'Cajero'),
    round(_opening_amount, 2),
    NULLIF(trim(COALESCE(_opening_notes, '')), ''),
    'open'
  )
  RETURNING * INTO _session;

  RETURN _session;
END;
$$;

-- 2) verificarEstadoCaja: caja abierta del usuario actual (si existe)
CREATE OR REPLACE FUNCTION public.get_active_cash_session()
RETURNS public.cash_sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _session
  FROM public.cash_sessions
  WHERE user_id = _user_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  RETURN _session;
END;
$$;

-- 3) cerrarCaja: cierra la caja abierta del usuario actual
CREATE OR REPLACE FUNCTION public.close_cash_session(
  _counted_amount numeric,
  _closing_notes  text DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
  _cash_sales numeric;
  _expected numeric;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cerrar caja';
  END IF;

  IF _counted_amount IS NULL OR _counted_amount < 0 THEN
    RAISE EXCEPTION 'El monto contado debe ser mayor o igual a cero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  SELECT * INTO _session
  FROM public.cash_sessions
  WHERE user_id = _user_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay caja abierta para cerrar';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE user_id = _user_id
    AND payment_method = 'Efectivo'
    AND created_at >= _session.opened_at;

  _expected := COALESCE(_session.opening_amount, 0) + _cash_sales;

  UPDATE public.cash_sessions
  SET status          = 'closed',
      closed_at       = now(),
      counted_amount  = round(_counted_amount, 2),
      expected_amount = round(_expected, 2),
      difference      = round(_counted_amount - _expected, 2),
      closing_notes   = NULLIF(trim(COALESCE(_closing_notes, '')), '')
  WHERE id = _session.id
  RETURNING * INTO _session;

  RETURN _session;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_session(numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_active_cash_session() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_session(numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO authenticated;
