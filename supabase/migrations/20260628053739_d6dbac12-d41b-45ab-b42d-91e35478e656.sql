CREATE OR REPLACE FUNCTION public.open_cash_session(
  _opening_amount numeric,
  _opening_notes text DEFAULT NULL,
  _user_name text DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para abrir caja';
  END IF;

  IF _opening_amount IS NULL OR _opening_amount < 0 THEN
    RAISE EXCEPTION 'El monto inicial debe ser mayor o igual a cero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  UPDATE public.cash_sessions
  SET
    status = 'closed',
    closed_at = COALESCE(closed_at, now()),
    expected_amount = COALESCE(expected_amount, opening_amount),
    counted_amount = COALESCE(counted_amount, opening_amount),
    difference = COALESCE(difference, 0),
    closing_notes = trim(both ' ' from COALESCE(closing_notes || ' ', '') || '[auto-cerrada al abrir nueva caja]')
  WHERE user_id = _user_id
    AND status = 'open';

  INSERT INTO public.cash_sessions (
    user_id,
    user_name,
    opening_amount,
    opening_notes,
    status
  )
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

REVOKE ALL ON FUNCTION public.open_cash_session(numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_cash_session(numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text) TO authenticated;