CREATE OR REPLACE FUNCTION public.sync_active_cash_session(_branch_id uuid DEFAULT NULL::uuid, _user_name text DEFAULT NULL::text)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _target_branch_id uuid := _branch_id;
  _session public.cash_sessions;
  _already_logged boolean := false;
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

  IF _session.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _session.user_id <> _user_id THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.audit_log a
      WHERE a.entity = 'cash_session'
        AND a.entity_id = _session.id
        AND a.action = 'cash_session_synced'
        AND a.user_id = _user_id
        AND a.created_at >= now() - interval '8 hours'
    ) INTO _already_logged;

    IF NOT COALESCE(_already_logged, false) THEN
      INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, after, meta)
      VALUES (
        'cash_session',
        _session.id,
        'cash_session_synced',
        _user_id,
        COALESCE(NULLIF(trim(_user_name), ''), (SELECT full_name FROM public.profiles WHERE id = _user_id), 'Usuario'),
        _target_branch_id,
        jsonb_build_object(
          'cash_session_id', _session.id,
          'opened_by_user_id', _session.user_id,
          'opened_by_user_name', _session.user_name,
          'opened_at', _session.opened_at,
          'synced_at', now()
        ),
        jsonb_build_object('source', 'automatic_cash_session_sync')
      );
    END IF;
  END IF;

  RETURN _session;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_active_cash_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_active_cash_session(uuid, text) TO authenticated;

-- Mantener una sola caja abierta por sede. El índice existente cubre la sede;
-- se deja de forma idempotente para entornos donde aún no exista.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_cash_session_per_branch
  ON public.cash_sessions(branch_id)
  WHERE status = 'open' AND branch_id IS NOT NULL;