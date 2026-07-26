
CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_bootstrap(
  _token text,
  _phone text,
  _limit int DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context jsonb;
  v_cart jsonb;
  v_history jsonb;
  v_ordering jsonb;
BEGIN
  v_context := public.whatsapp_bot_ai_context(_token, _phone);
  IF v_context ? 'error' THEN
    RETURN jsonb_build_object('context', v_context);
  END IF;

  BEGIN
    v_cart := public.whatsapp_bot_ai_cart_get(_token, _phone);
  EXCEPTION WHEN OTHERS THEN
    v_cart := NULL;
  END;

  BEGIN
    v_history := public.whatsapp_bot_ai_history(_token, _phone, _limit);
  EXCEPTION WHEN OTHERS THEN
    v_history := jsonb_build_object('messages', '[]'::jsonb);
  END;

  BEGIN
    v_ordering := public.whatsapp_bot_ai_ordering_config(_token);
  EXCEPTION WHEN OTHERS THEN
    v_ordering := NULL;
  END;

  RETURN jsonb_build_object(
    'context', v_context,
    'cart', v_cart,
    'history', v_history,
    'ordering', v_ordering
  );
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_ai_bootstrap(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_bootstrap(text, text, int) TO anon, authenticated, service_role;
