CREATE TABLE public.whatsapp_inbound_receipts (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  phone_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, provider_message_id)
);
GRANT ALL ON public.whatsapp_inbound_receipts TO service_role;
ALTER TABLE public.whatsapp_inbound_receipts ENABLE ROW LEVEL SECURITY;

CREATE INDEX whatsapp_inbound_receipts_received_at_idx
  ON public.whatsapp_inbound_receipts(received_at);

CREATE OR REPLACE FUNCTION public.whatsapp_bot_handle_incoming(
  _token text,
  _from text,
  _body text,
  _msg_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_phone_key text;
  v_inserted integer;
BEGIN
  v_branch_id := public.whatsapp_bot_resolve_branch(_token);
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  v_phone_key := public.whatsapp_bot_contact_key(_from);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch_id::text || ':' || v_phone_key, 0));

  IF nullif(btrim(coalesce(_msg_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.whatsapp_inbound_receipts(branch_id, provider_message_id, phone_key)
    VALUES (v_branch_id, btrim(_msg_id), v_phone_key)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      RETURN jsonb_build_object('reply', null, 'skipped', 'duplicate_message');
    END IF;
  END IF;

  DELETE FROM public.whatsapp_inbound_receipts
   WHERE received_at < now() - interval '7 days';

  RETURN public.whatsapp_bot_handle_incoming(_token, _from, _body);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_handle_incoming(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text,text,text,text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.whatsapp_bot_get_ai_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_ai_keys(text) TO service_role;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%'
      ))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END $$;