ALTER TABLE public.whatsapp_inbound_receipts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.whatsapp_inbound_receipts
  DROP CONSTRAINT IF EXISTS whatsapp_inbound_receipts_status_check;
ALTER TABLE public.whatsapp_inbound_receipts
  ADD CONSTRAINT whatsapp_inbound_receipts_status_check
  CHECK (status IN ('processing','delivered','failed'));

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
  v_receipt public.whatsapp_inbound_receipts%ROWTYPE;
BEGIN
  v_branch_id := public.whatsapp_bot_resolve_branch(_token);
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  v_phone_key := public.whatsapp_bot_contact_key(_from);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch_id::text || ':' || v_phone_key, 0));

  IF nullif(btrim(coalesce(_msg_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_receipt
    FROM public.whatsapp_inbound_receipts
    WHERE branch_id = v_branch_id AND provider_message_id = btrim(_msg_id)
    FOR UPDATE;

    IF FOUND THEN
      IF v_receipt.status = 'delivered' THEN
        RETURN jsonb_build_object('reply', null, 'skipped', 'duplicate_message_delivered');
      END IF;
      IF v_receipt.status = 'processing' AND coalesce(v_receipt.lease_until, v_receipt.received_at + interval '2 minutes') > now() THEN
        RETURN jsonb_build_object('reply', null, 'skipped', 'duplicate_message_processing');
      END IF;
      UPDATE public.whatsapp_inbound_receipts
      SET status = 'processing', attempts = attempts + 1, lease_until = now() + interval '2 minutes', last_error = NULL
      WHERE branch_id = v_branch_id AND provider_message_id = btrim(_msg_id);
    ELSE
      INSERT INTO public.whatsapp_inbound_receipts(branch_id, provider_message_id, phone_key, status, attempts, lease_until)
      VALUES (v_branch_id, btrim(_msg_id), v_phone_key, 'processing', 1, now() + interval '2 minutes');
    END IF;
  END IF;

  DELETE FROM public.whatsapp_inbound_receipts
   WHERE received_at < now() - interval '7 days';

  RETURN public.whatsapp_bot_handle_incoming(_token, _from, _body);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_complete_incoming(
  _token text,
  _msg_id text,
  _delivered boolean,
  _error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  v_branch_id := public.whatsapp_bot_resolve_branch(_token);
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'invalid token';
  END IF;
  IF nullif(btrim(coalesce(_msg_id, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.whatsapp_inbound_receipts
  SET status = CASE WHEN _delivered THEN 'delivered' ELSE 'failed' END,
      completed_at = CASE WHEN _delivered THEN now() ELSE NULL END,
      lease_until = NULL,
      last_error = CASE WHEN _delivered THEN NULL ELSE left(coalesce(_error, 'delivery_failed'), 1000) END
  WHERE branch_id = v_branch_id AND provider_message_id = btrim(_msg_id);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_handle_incoming(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_handle_incoming(text,text,text,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.whatsapp_bot_complete_incoming(text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_complete_incoming(text,text,boolean,text) TO anon, authenticated, service_role;