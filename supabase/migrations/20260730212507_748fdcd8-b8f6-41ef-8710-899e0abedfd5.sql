DO $do$
DECLARE r record; src text;
BEGIN
  FOR r IN
    SELECT oid, pg_get_function_identity_arguments(oid) AS args, prosrc
    FROM pg_proc WHERE proname = 'whatsapp_bot_handle_incoming'
  LOOP
    src := replace(r.prosrc,
      'ELSIF position(v_menu_link in v_reply) = 0 THEN',
      'ELSIF v_reply !~* ''https?://'' THEN');
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
      r.args, src);
  END LOOP;
END
$do$;