
-- 1) _shared_dashboard_payload usa CREATE TEMP TABLE, requiere VOLATILE
ALTER FUNCTION public._shared_dashboard_payload(uuid, timestamptz, timestamptz, text, text) VOLATILE;
ALTER FUNCTION public.admin_dashboard_rpc(uuid, text, text, text) VOLATILE;

-- 2) admin_create_supervisor_rpc / admin_update_supervisor_rpc no ven gen_salt/crypt
--    (viven en el esquema extensions). Añadimos extensions al search_path.
CREATE OR REPLACE FUNCTION public.admin_create_supervisor_rpc(_display_name text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_id uuid; v_name text; v_uname text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  IF _display_name IS NULL OR btrim(_display_name)='' OR _pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Nombre y PIN de 4 dígitos son obligatorios' USING ERRCODE='22023';
  END IF;
  v_name := btrim(_display_name);
  v_uname := regexp_replace(lower(v_name),'[^a-z0-9]+','_','g') || '_' || substr(md5(random()::text),1,4);
  INSERT INTO supervisor_accounts(display_name, username, pin_hash, active)
    VALUES (v_name, v_uname, extensions.crypt(_pin, extensions.gen_salt('bf')), true)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'display_name', v_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_supervisor_rpc(_id uuid, _display_name text DEFAULT NULL, _pin text DEFAULT NULL, _active boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Solo admin' USING ERRCODE='42501'; END IF;
  IF _pin IS NOT NULL AND _pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN inválido' USING ERRCODE='22023'; END IF;

  UPDATE supervisor_accounts SET
    display_name = COALESCE(NULLIF(btrim(_display_name),''), display_name),
    pin_hash     = CASE WHEN _pin IS NOT NULL THEN extensions.crypt(_pin, extensions.gen_salt('bf')) ELSE pin_hash END,
    active       = COALESCE(_active, active),
    failed_attempts = CASE WHEN _active = true THEN 0 ELSE failed_attempts END,
    locked_until    = CASE WHEN _active = true THEN NULL ELSE locked_until END,
    updated_at   = now()
  WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supervisor no encontrado' USING ERRCODE='02000'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
