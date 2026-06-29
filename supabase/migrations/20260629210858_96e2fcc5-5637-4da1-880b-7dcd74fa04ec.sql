
-- 0) Cerrar duplicados: mantener sólo la apertura más reciente por sede
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY branch_id ORDER BY opened_at DESC) AS rn
  FROM public.cash_sessions
  WHERE status = 'open' AND branch_id IS NOT NULL
)
UPDATE public.cash_sessions cs
   SET status = 'closed',
       closed_at = COALESCE(cs.closed_at, now()),
       closing_notes = COALESCE(cs.closing_notes, '') ||
         CASE WHEN COALESCE(cs.closing_notes,'') = '' THEN '' ELSE E'\n' END ||
         '[Cierre automático por duplicado de sede]'
  FROM ranked r
 WHERE cs.id = r.id AND r.rn > 1;

-- 1) Índice único parcial: una sola caja abierta por sede
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_cash_session_per_branch
  ON public.cash_sessions (branch_id)
  WHERE status = 'open' AND branch_id IS NOT NULL;

-- 2) Función con parámetro de sede + bloqueo de duplicados
CREATE OR REPLACE FUNCTION public.open_cash_session(
  _opening_amount numeric,
  _opening_notes text DEFAULT NULL,
  _user_name text DEFAULT NULL,
  _branch_id uuid DEFAULT NULL
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar la sede antes de abrir caja';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cash_open:' || _branch_id::text));

  SELECT * INTO _existing
  FROM public.cash_sessions
  WHERE branch_id = _branch_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.cash_sessions (
    user_id, user_name, opening_amount, opening_notes, status, branch_id
  ) VALUES (
    _user_id,
    COALESCE(NULLIF(trim(_user_name), ''), 'Cajero'),
    round(_opening_amount, 2),
    NULLIF(trim(COALESCE(_opening_notes, '')), ''),
    'open',
    _branch_id
  )
  RETURNING * INTO _session;

  RETURN _session;
END;
$function$;
