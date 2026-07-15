CREATE OR REPLACE FUNCTION public.supervisor_hash_pin(_pin text, _salt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(_salt || '::' || _pin, 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.supervisor_slug(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(
      trim(both '-' from regexp_replace(lower(COALESCE(_value, '')), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'sup'
  )
$$;

CREATE OR REPLACE FUNCTION public.assert_current_user_is_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;

  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_supervisor_accounts_rpc()
RETURNS TABLE(
  id uuid,
  username text,
  display_name text,
  active boolean,
  access_token text,
  last_login_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_current_user_is_admin();

  RETURN QUERY
  SELECT
    a.id,
    a.username,
    a.display_name,
    a.active,
    a.access_token,
    a.last_login_at,
    a.locked_until,
    a.created_at
  FROM public.supervisor_accounts a
  ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_supervisor_account_rpc(_display_name text, _pin text)
RETURNS TABLE(id uuid, access_token text, username text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _name text := btrim(COALESCE(_display_name, ''));
  _salt text;
  _pin_hash text;
  _base text;
  _username text;
  _row public.supervisor_accounts%ROWTYPE;
BEGIN
  PERFORM public.assert_current_user_is_admin();

  IF length(_name) < 2 OR length(_name) > 80 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 2 y 80 caracteres';
  END IF;

  IF COALESCE(_pin, '') !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN debe ser 4 dígitos';
  END IF;

  _salt := encode(extensions.gen_random_bytes(16), 'hex');
  _pin_hash := _salt || ':' || public.supervisor_hash_pin(_pin, _salt);
  _base := left(public.supervisor_slug(_name), 24);

  LOOP
    _username := _base || '-' || encode(extensions.gen_random_bytes(3), 'hex');
    BEGIN
      INSERT INTO public.supervisor_accounts(username, display_name, pin_hash)
      VALUES (_username, _name, _pin_hash)
      RETURNING * INTO _row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- try another random suffix
    END;
  END LOOP;

  id := _row.id;
  access_token := _row.access_token;
  username := _row.username;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supervisor_account_rpc(
  _id uuid,
  _display_name text DEFAULT NULL,
  _pin text DEFAULT NULL,
  _active boolean DEFAULT NULL,
  _regenerate_token boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _patch_name text;
  _salt text;
  _new_pin_hash text;
BEGIN
  PERFORM public.assert_current_user_is_admin();

  IF _id IS NULL THEN
    RAISE EXCEPTION 'Supervisor inválido';
  END IF;

  IF _display_name IS NOT NULL THEN
    _patch_name := btrim(_display_name);
    IF length(_patch_name) < 2 OR length(_patch_name) > 80 THEN
      RAISE EXCEPTION 'El nombre debe tener entre 2 y 80 caracteres';
    END IF;
  END IF;

  IF _pin IS NOT NULL AND _pin <> '' THEN
    IF _pin !~ '^\d{4}$' THEN
      RAISE EXCEPTION 'PIN debe ser 4 dígitos';
    END IF;
    _salt := encode(extensions.gen_random_bytes(16), 'hex');
    _new_pin_hash := _salt || ':' || public.supervisor_hash_pin(_pin, _salt);
  END IF;

  UPDATE public.supervisor_accounts
  SET
    display_name = COALESCE(_patch_name, display_name),
    active = COALESCE(_active, active),
    pin_hash = COALESCE(_new_pin_hash, pin_hash),
    failed_attempts = CASE WHEN _new_pin_hash IS NULL THEN failed_attempts ELSE 0 END,
    locked_until = CASE WHEN _new_pin_hash IS NULL THEN locked_until ELSE NULL END,
    access_token = CASE WHEN COALESCE(_regenerate_token, false) THEN encode(extensions.gen_random_bytes(18), 'hex') ELSE access_token END
  WHERE supervisor_accounts.id = _id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supervisor no encontrado';
  END IF;

  IF COALESCE(_regenerate_token, false) THEN
    UPDATE public.supervisor_sessions
    SET revoked_at = now()
    WHERE account_id = _id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_supervisor_account_rpc(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_current_user_is_admin();

  DELETE FROM public.supervisor_accounts
  WHERE supervisor_accounts.id = _id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supervisor no encontrado';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_login_rpc(
  _token text DEFAULT NULL,
  _display_name text DEFAULT NULL,
  _username text DEFAULT NULL,
  _pin text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS TABLE(session_token text, expires_at timestamptz, display_name text, username text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct public.supervisor_accounts%ROWTYPE;
  _salt text;
  _expected text;
  _attempts integer;
  _lock_until timestamptz;
  _session public.supervisor_sessions%ROWTYPE;
  _identifier text := COALESCE(NULLIF(_display_name, ''), NULLIF(_username, ''), 'unknown');
BEGIN
  IF COALESCE(_pin, '') !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN debe ser 4 dígitos';
  END IF;

  IF NULLIF(_token, '') IS NOT NULL THEN
    SELECT * INTO _acct FROM public.supervisor_accounts WHERE access_token = _token LIMIT 1;
  ELSIF NULLIF(btrim(COALESCE(_display_name, '')), '') IS NOT NULL THEN
    SELECT * INTO _acct FROM public.supervisor_accounts WHERE lower(display_name) = lower(btrim(_display_name)) ORDER BY created_at DESC LIMIT 1;
  ELSIF NULLIF(btrim(COALESCE(_username, '')), '') IS NOT NULL THEN
    SELECT * INTO _acct FROM public.supervisor_accounts WHERE username = lower(btrim(_username)) LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Falta identificar el supervisor';
  END IF;

  IF _acct.id IS NULL THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail, user_agent)
    VALUES (NULL, _identifier, 'login_failed', jsonb_build_object('reason', 'not_found'), _user_agent);
    RAISE EXCEPTION 'Credenciales incorrectas';
  END IF;

  _identifier := _acct.username;

  IF NOT _acct.active THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail, user_agent)
    VALUES (_acct.id, _identifier, 'login_failed', jsonb_build_object('reason', 'inactive'), _user_agent);
    RAISE EXCEPTION 'Acceso desactivado';
  END IF;

  IF _acct.locked_until IS NOT NULL AND _acct.locked_until > now() THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail, user_agent)
    VALUES (_acct.id, _identifier, 'login_failed', jsonb_build_object('reason', 'locked'), _user_agent);
    RAISE EXCEPTION 'Acceso bloqueado temporalmente. Intenta más tarde.';
  END IF;

  _salt := split_part(_acct.pin_hash, ':', 1);
  _expected := split_part(_acct.pin_hash, ':', 2);

  IF _salt = '' OR _expected = '' OR _expected <> public.supervisor_hash_pin(_pin, _salt) THEN
    _attempts := COALESCE(_acct.failed_attempts, 0) + 1;
    _lock_until := CASE WHEN _attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END;

    UPDATE public.supervisor_accounts
    SET failed_attempts = _attempts,
        locked_until = _lock_until
    WHERE id = _acct.id;

    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail, user_agent)
    VALUES (_acct.id, _identifier, 'login_failed', jsonb_build_object('reason', 'bad_pin'), _user_agent);

    IF _lock_until IS NOT NULL THEN
      RAISE EXCEPTION 'Demasiados intentos. Acceso bloqueado 15 min.';
    END IF;

    RAISE EXCEPTION 'Credenciales incorrectas';
  END IF;

  INSERT INTO public.supervisor_sessions(account_id, user_agent)
  VALUES (_acct.id, _user_agent)
  RETURNING * INTO _session;

  UPDATE public.supervisor_accounts
  SET failed_attempts = 0,
      locked_until = NULL,
      last_login_at = now()
  WHERE id = _acct.id;

  INSERT INTO public.supervisor_audit_log(account_id, username, event, user_agent)
  VALUES (_acct.id, _identifier, 'login_success', _user_agent);

  session_token := _session.session_token;
  expires_at := _session.expires_at;
  display_name := _acct.display_name;
  username := _acct.username;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_supervisor_session_rpc(_session_token text)
RETURNS TABLE(account_id uuid, username text, display_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.username, a.display_name
  FROM public.supervisor_sessions s
  JOIN public.supervisor_accounts a ON a.id = s.account_id
  WHERE s.session_token = _session_token
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND a.active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión expirada';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_logout_rpc(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sess record;
BEGIN
  SELECT s.id, s.account_id, a.username
  INTO _sess
  FROM public.supervisor_sessions s
  LEFT JOIN public.supervisor_accounts a ON a.id = s.account_id
  WHERE s.session_token = _session_token
  LIMIT 1;

  IF _sess.id IS NOT NULL THEN
    UPDATE public.supervisor_sessions
    SET revoked_at = now()
    WHERE id = _sess.id;

    INSERT INTO public.supervisor_audit_log(account_id, username, event)
    VALUES (_sess.account_id, _sess.username, 'logout');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_dashboard_rpc(
  _session_token text,
  _branch_id uuid DEFAULT NULL,
  _log_switch boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct record;
  _branches jsonb;
  _active_branch uuid;
  _start_day timestamptz := date_trunc('day', now());
  _summary jsonb;
  _by_hour jsonb;
  _by_service jsonb;
  _by_payment jsonb;
  _top_products jsonb;
  _low_products jsonb;
  _active_cash jsonb;
BEGIN
  SELECT * INTO _acct FROM public.require_supervisor_session_rpc(_session_token) LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'is_main', b.is_main) ORDER BY b.is_main DESC, b.name), '[]'::jsonb)
  INTO _branches
  FROM public.branches b;

  SELECT COALESCE(
    _branch_id,
    (SELECT b.id FROM public.branches b WHERE b.is_main ORDER BY b.name LIMIT 1),
    (SELECT b.id FROM public.branches b ORDER BY b.name LIMIT 1)
  ) INTO _active_branch;

  IF COALESCE(_log_switch, false) AND _active_branch IS NOT NULL THEN
    INSERT INTO public.supervisor_audit_log(account_id, username, event, detail)
    VALUES (_acct.account_id, _acct.username, 'branch_switch', jsonb_build_object('branch_id', _active_branch));
  END IF;

  WITH sales_today AS (
    SELECT *
    FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  ), open_orders AS (
    SELECT *
    FROM public.sales s
    WHERE (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND s.status IN ('open', 'pending', 'in_progress', 'ready', 'preparing')
  )
  SELECT jsonb_build_object(
    'total_sales', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today), 0),
    'order_count', COALESCE((SELECT count(*) FROM sales_today), 0),
    'avg_ticket', COALESCE((SELECT avg(COALESCE(total, 0)) FROM sales_today), 0),
    'cash_total', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today WHERE lower(COALESCE(payment_method, '')) LIKE '%efectivo%' OR lower(COALESCE(payment_method, '')) = 'cash' OR lower(COALESCE(payment_method, '')) LIKE '%mixto%'), 0),
    'digital_total', COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today), 0) - COALESCE((SELECT sum(COALESCE(total, 0)) FROM sales_today WHERE lower(COALESCE(payment_method, '')) LIKE '%efectivo%' OR lower(COALESCE(payment_method, '')) = 'cash' OR lower(COALESCE(payment_method, '')) LIKE '%mixto%'), 0),
    'tables_occupied', COALESCE((SELECT count(DISTINCT table_id) FROM open_orders WHERE order_type = 'mesa' AND table_id IS NOT NULL), 0),
    'pending_llevar', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'llevar'), 0),
    'pending_domicilio', COALESCE((SELECT count(*) FROM open_orders WHERE order_type = 'domicilio'), 0),
    'preparing', COALESCE((SELECT count(*) FROM open_orders WHERE status IN ('preparing', 'in_progress')), 0)
  ) INTO _summary;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(h, total), '{}'::jsonb)
  INTO _by_hour
  FROM (
    SELECT to_char(created_at, 'HH24') AS h, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_service
  FROM (
    SELECT COALESCE(order_type, 'otro') AS k, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT * FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  )
  SELECT COALESCE(jsonb_object_agg(k, total), '{}'::jsonb)
  INTO _by_payment
  FROM (
    SELECT COALESCE(payment_method, 'otro') AS k, sum(COALESCE(total, 0)) AS total
    FROM sales_today
    GROUP BY 1
  ) q;

  WITH sales_today AS (
    SELECT id FROM public.sales s
    WHERE s.created_at >= _start_day
      AND (_active_branch IS NULL OR s.branch_id = _active_branch)
      AND COALESCE(s.status, '') <> 'cancelled'
  ), product_totals AS (
    SELECT COALESCE(si.product_name, '—') AS name, sum(COALESCE(si.quantity, 0)) AS qty
    FROM public.sale_items si
    JOIN sales_today st ON st.id = si.sale_id
    GROUP BY 1
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty) ORDER BY qty DESC, name) FROM (SELECT * FROM product_totals ORDER BY qty DESC, name LIMIT 5) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty) ORDER BY qty ASC, name) FROM (SELECT * FROM product_totals ORDER BY qty ASC, name LIMIT 5) t), '[]'::jsonb)
  INTO _top_products, _low_products;

  SELECT to_jsonb(c)
  INTO _active_cash
  FROM (
    SELECT cs.id, cs.status, cs.opened_at, cs.closed_at, cs.opening_amount, cs.user_name, cs.user_id
    FROM public.cash_sessions cs
    WHERE (_active_branch IS NULL OR cs.branch_id = _active_branch)
    ORDER BY cs.opened_at DESC
    LIMIT 1
  ) c;

  RETURN jsonb_build_object(
    'supervisor', jsonb_build_object('username', _acct.username, 'display_name', _acct.display_name),
    'branches', _branches,
    'active_branch_id', _active_branch,
    'generated_at', now(),
    'summary', _summary,
    'by_hour', COALESCE(_by_hour, '{}'::jsonb),
    'by_service', COALESCE(_by_service, '{}'::jsonb),
    'by_payment', COALESCE(_by_payment, '{}'::jsonb),
    'top_products', COALESCE(_top_products, '[]'::jsonb),
    'low_products', COALESCE(_low_products, '[]'::jsonb),
    'active_cash', _active_cash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_supervisor_audit_rpc()
RETURNS SETOF public.supervisor_audit_log
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_current_user_is_admin();

  RETURN QUERY
  SELECT *
  FROM public.supervisor_audit_log
  ORDER BY created_at DESC
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_hash_pin(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_supervisor_accounts_rpc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_supervisor_account_rpc(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_supervisor_account_rpc(uuid, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_supervisor_account_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_login_rpc(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_supervisor_session_rpc(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_logout_rpc(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_dashboard_rpc(text, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_supervisor_audit_rpc() TO authenticated;