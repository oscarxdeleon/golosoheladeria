-- Corregir sesión abierta registrada en la sede equivocada para la cajera de GOLOSO PARQUE
UPDATE public.cash_sessions cs
SET branch_id = p.branch_id
FROM public.profiles p
WHERE cs.user_id = p.id
  AND cs.status = 'open'
  AND p.branch_id IS NOT NULL
  AND cs.branch_id IS DISTINCT FROM p.branch_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.cash_sessions other
    WHERE other.branch_id = p.branch_id
      AND other.status = 'open'
      AND other.id <> cs.id
  );

-- Cerrar duplicados por usuario heredados del flujo anterior, conservando la caja más reciente por sede
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY branch_id ORDER BY opened_at DESC, id DESC) AS rn
  FROM public.cash_sessions
  WHERE status = 'open'
    AND branch_id IS NOT NULL
)
UPDATE public.cash_sessions cs
SET status = 'closed',
    closed_at = COALESCE(closed_at, now()),
    closing_notes = COALESCE(closing_notes, 'Cierre automático por corrección de caja duplicada por sede')
FROM ranked r
WHERE cs.id = r.id
  AND r.rn > 1;

-- La restricción anterior por usuario impide que un cajero trabaje sedes distintas y causó asignaciones incorrectas.
DROP INDEX IF EXISTS public.cash_sessions_one_open_per_user;

-- Garantía de concurrencia por sede: sólo una caja abierta por cada sede.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_cash_session_per_branch
ON public.cash_sessions (branch_id)
WHERE status = 'open' AND branch_id IS NOT NULL;

-- Eliminar la versión antigua que permitía abrir caja sin sede.
DROP FUNCTION IF EXISTS public.open_cash_session(numeric, text, text);

CREATE OR REPLACE FUNCTION public.open_cash_session(
  _opening_amount numeric,
  _opening_notes text DEFAULT NULL::text,
  _user_name text DEFAULT NULL::text,
  _branch_id uuid DEFAULT NULL::uuid
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

  IF _branch_id IS NULL THEN
    SELECT branch_id INTO _branch_id
    FROM public.profiles
    WHERE id = _user_id;
  END IF;

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'Debes seleccionar la sede antes de abrir caja';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch_id) THEN
    RAISE EXCEPTION 'La sede seleccionada no existe';
  END IF;

  -- Bloqueo transaccional por sede para evitar doble apertura simultánea.
  PERFORM pg_advisory_xact_lock(hashtext('cash_open_branch:' || _branch_id::text));

  SELECT * INTO _existing
  FROM public.cash_sessions
  WHERE branch_id = _branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.cash_sessions (
    user_id,
    user_name,
    opening_amount,
    opening_notes,
    status,
    branch_id
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
$$;

REVOKE ALL ON FUNCTION public.open_cash_session(numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.get_active_cash_session();

CREATE OR REPLACE FUNCTION public.get_active_cash_session(_branch_id uuid DEFAULT NULL::uuid)
RETURNS public.cash_sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _target_branch_id uuid := _branch_id;
  _session public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _target_branch_id IS NULL THEN
    SELECT branch_id INTO _target_branch_id
    FROM public.profiles
    WHERE id = _user_id;
  END IF;

  IF _target_branch_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _session
  FROM public.cash_sessions
  WHERE branch_id = _target_branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  RETURN _session;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_cash_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session(uuid) TO service_role;