DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'whatsapp_bot_handle_incoming';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'whatsapp_bot_handle_incoming no existe';
  END IF;

  -- Selección aleatoria (antes: round-robin) evitando repetir el último índice.
  v_def := replace(
    v_def,
    'v_idx := ((coalesce(v_last_idx, -1) + 1) % v_len);',
    'v_idx := floor(random() * v_len)::int; IF v_len > 1 AND v_idx = coalesce(v_last_idx, -1) THEN v_idx := (v_idx + 1) % v_len; END IF;'
  );

  -- Respetar el texto exacto: solo agregar el link si el mensaje no trae ninguno.
  v_def := replace(
    v_def,
    'ELSIF position(v_menu_link in v_reply) = 0 THEN',
    'ELSIF position(''http'' in lower(v_reply)) = 0 THEN'
  );

  EXECUTE v_def;
END
$mig$;