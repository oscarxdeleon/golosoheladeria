
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS ai_dry_run boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_ordering_config(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid; cfg public.whatsapp_bot_config%ROWTYPE;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  RETURN jsonb_build_object(
    'ordering_enabled', COALESCE(cfg.ai_ordering_enabled, false),
    'min_amount', COALESCE(cfg.ordering_min_amount, 0),
    'delivery_fee', COALESCE(cfg.ordering_delivery_fee, 0),
    'zones', cfg.ordering_delivery_zones,
    'transfer_info', cfg.ordering_transfer_info,
    'dry_run', COALESCE(cfg.ai_dry_run, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_ordering_config(text) TO anon, authenticated;
