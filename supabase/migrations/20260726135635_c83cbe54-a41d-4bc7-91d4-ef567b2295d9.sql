ALTER TABLE public.whatsapp_ai_carts
  ADD COLUMN IF NOT EXISTS pending_product jsonb,
  ADD COLUMN IF NOT EXISTS fsm_state text NOT NULL DEFAULT 'GREETING',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_upsert(_token text, _phone text, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bid uuid;
  cart_row public.whatsapp_ai_carts%ROWTYPE;
  new_items jsonb;
  new_subtotal numeric := 0;
  new_fee numeric;
  new_order_type text;
  v_key text;
  new_pending jsonb;
  new_fsm text;
  new_metadata jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  v_key := public.whatsapp_bot_contact_key(_phone);

  UPDATE public.whatsapp_ai_carts
  SET status = 'expired', updated_at = now()
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
    AND coalesce(expires_at, updated_at + interval '45 minutes') <= now();

  SELECT * INTO cart_row
  FROM public.whatsapp_ai_carts
  WHERE branch_id = bid
    AND public.whatsapp_bot_contact_key(phone) = v_key
    AND status = 'building'
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_ai_carts (branch_id, phone, expires_at)
    VALUES (bid, v_key, now() + interval '45 minutes')
    RETURNING * INTO cart_row;
  END IF;

  new_items := COALESCE(_patch->'items', cart_row.items, '[]'::jsonb);

  SELECT COALESCE(SUM(
    (COALESCE((item->>'unit_price')::numeric,0)
      + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m),0)
    ) * COALESCE((item->>'qty')::numeric,1)
  ),0)
  INTO new_subtotal
  FROM jsonb_array_elements(new_items) item;

  new_order_type := lower(coalesce(_patch->>'order_type', cart_row.order_type, 'delivery'));
  IF new_order_type NOT IN ('delivery', 'pickup') THEN
    new_order_type := 'delivery';
  END IF;

  new_fee := CASE
    WHEN new_order_type = 'pickup' THEN 0
    WHEN _patch ? 'delivery_fee' AND coalesce(_patch->>'delivery_fee','') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (_patch->>'delivery_fee')::numeric
    ELSE coalesce(cart_row.delivery_fee, 0)
  END;

  -- Nuevos campos de estado
  new_pending := CASE
    WHEN _patch ? 'pending_product' THEN
      CASE WHEN _patch->'pending_product' = 'null'::jsonb THEN NULL ELSE _patch->'pending_product' END
    ELSE cart_row.pending_product
  END;

  new_fsm := COALESCE(NULLIF(_patch->>'fsm_state',''), cart_row.fsm_state, 'GREETING');

  new_metadata := CASE
    WHEN _patch ? 'metadata' THEN COALESCE(cart_row.metadata,'{}'::jsonb) || (_patch->'metadata')
    ELSE COALESCE(cart_row.metadata,'{}'::jsonb)
  END;

  UPDATE public.whatsapp_ai_carts SET
    phone = v_key,
    items = new_items,
    order_type = new_order_type,
    customer_name = COALESCE(NULLIF(_patch->>'customer_name', ''), cart_row.customer_name),
    delivery_address = COALESCE(NULLIF(_patch->>'delivery_address', ''), cart_row.delivery_address),
    delivery_neighborhood = COALESCE(NULLIF(_patch->>'delivery_neighborhood', ''), cart_row.delivery_neighborhood),
    delivery_notes = COALESCE(NULLIF(_patch->>'delivery_notes', ''), cart_row.delivery_notes),
    payment_method = COALESCE(NULLIF(_patch->>'payment_method', ''), cart_row.payment_method),
    delivery_fee = new_fee,
    subtotal = new_subtotal,
    total = new_subtotal + new_fee,
    pending_product = new_pending,
    fsm_state = new_fsm,
    metadata = new_metadata,
    expires_at = now() + interval '45 minutes',
    updated_at = now()
  WHERE id = cart_row.id
  RETURNING * INTO cart_row;

  RETURN to_jsonb(cart_row);
END;
$function$;