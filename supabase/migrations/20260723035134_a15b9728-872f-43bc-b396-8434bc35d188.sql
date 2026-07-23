
ALTER TABLE public.whatsapp_bot_config
  ADD COLUMN IF NOT EXISTS ai_ordering_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordering_min_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ordering_delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ordering_delivery_zones text,
  ADD COLUMN IF NOT EXISTS ordering_transfer_info text,
  ADD COLUMN IF NOT EXISTS ordering_daily_limit_per_phone integer NOT NULL DEFAULT 3;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS ai_review_status text,
  ADD COLUMN IF NOT EXISTS ai_cart_id uuid;

CREATE INDEX IF NOT EXISTS sales_ai_review_status_idx
  ON public.sales(branch_id, ai_review_status)
  WHERE ai_review_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'building',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_name text,
  delivery_address text,
  delivery_neighborhood text,
  delivery_notes text,
  payment_method text,
  delivery_fee numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  posted_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '3 hours'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_ai_carts TO authenticated;
GRANT ALL ON public.whatsapp_ai_carts TO service_role;

ALTER TABLE public.whatsapp_ai_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carts_staff_read" ON public.whatsapp_ai_carts;
CREATE POLICY "carts_staff_read"
  ON public.whatsapp_ai_carts FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'cajero')
  );

CREATE INDEX IF NOT EXISTS whatsapp_ai_carts_lookup_idx
  ON public.whatsapp_ai_carts(branch_id, phone, status);

CREATE OR REPLACE FUNCTION public.whatsapp_ai_carts_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS whatsapp_ai_carts_touch_tr ON public.whatsapp_ai_carts;
CREATE TRIGGER whatsapp_ai_carts_touch_tr
  BEFORE UPDATE ON public.whatsapp_ai_carts
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_ai_carts_touch();

CREATE OR REPLACE FUNCTION public.whatsapp_bot_resolve_branch(_token text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid;
BEGIN
  SELECT branch_id INTO bid FROM public.whatsapp_bot_config WHERE device_token = _token LIMIT 1;
  RETURN bid;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_search_products(_token text, _query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid; result jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO result
  FROM (
    SELECT id, name, price, modifier_group_ids
    FROM public.products
    WHERE active AND branch_id = bid
      AND (_query IS NULL OR _query = '' OR name ILIKE '%' || _query || '%')
    ORDER BY name LIMIT 20
  ) p;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_get_modifiers(_token text, _product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid; result jsonb;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'group_id', g.id, 'group_name', g.name, 'required', g.required,
    'min_select', g.min_select, 'max_select', g.max_select,
    'options', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price)), '[]'::jsonb)
      FROM public.modifiers m
      WHERE m.group_id = g.id AND m.active
        AND NOT (bid = ANY(COALESCE(m.disabled_branch_ids, ARRAY[]::uuid[])))
    )
  )), '[]'::jsonb) INTO result
  FROM public.modifier_groups g
  JOIN public.products p ON g.id = ANY(COALESCE(p.modifier_group_ids, ARRAY[]::uuid[]))
  WHERE p.id = _product_id AND p.branch_id = bid;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_upsert(_token text, _phone text, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid; cart_row public.whatsapp_ai_carts%ROWTYPE;
  new_items jsonb; new_subtotal numeric := 0; new_fee numeric;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT * INTO cart_row FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_ai_carts (branch_id, phone) VALUES (bid, _phone) RETURNING * INTO cart_row;
  END IF;
  new_items := COALESCE(_patch->'items', cart_row.items);
  SELECT COALESCE(SUM(
    (COALESCE((item->>'unit_price')::numeric,0)
      + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m),0)
    ) * COALESCE((item->>'qty')::numeric,1)
  ),0) INTO new_subtotal
  FROM jsonb_array_elements(new_items) item;
  new_fee := COALESCE((_patch->>'delivery_fee')::numeric, cart_row.delivery_fee);
  UPDATE public.whatsapp_ai_carts SET
    items = new_items,
    customer_name = COALESCE(_patch->>'customer_name', cart_row.customer_name),
    delivery_address = COALESCE(_patch->>'delivery_address', cart_row.delivery_address),
    delivery_neighborhood = COALESCE(_patch->>'delivery_neighborhood', cart_row.delivery_neighborhood),
    delivery_notes = COALESCE(_patch->>'delivery_notes', cart_row.delivery_notes),
    payment_method = COALESCE(_patch->>'payment_method', cart_row.payment_method),
    delivery_fee = new_fee, subtotal = new_subtotal, total = new_subtotal + new_fee
  WHERE id = cart_row.id RETURNING * INTO cart_row;
  RETURN to_jsonb(cart_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_confirm(_token text, _phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid; cart_row public.whatsapp_ai_carts%ROWTYPE; cfg public.whatsapp_bot_config%ROWTYPE;
  new_sale_id uuid; new_ticket integer; item jsonb; today_count integer;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT * INTO cfg FROM public.whatsapp_bot_config WHERE branch_id = bid;
  SELECT COUNT(*) INTO today_count FROM public.sales
  WHERE branch_id = bid AND customer_phone = _phone AND source = 'whatsapp_bot'
    AND created_at > (now() - interval '24 hours');
  IF today_count >= COALESCE(cfg.ordering_daily_limit_per_phone, 3) THEN
    RAISE EXCEPTION 'daily order limit exceeded';
  END IF;
  SELECT * INTO cart_row FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no active cart'; END IF;
  IF jsonb_array_length(cart_row.items) = 0 THEN RAISE EXCEPTION 'empty cart'; END IF;
  IF cart_row.delivery_address IS NULL OR cart_row.delivery_address = '' THEN RAISE EXCEPTION 'missing address'; END IF;
  IF cart_row.payment_method IS NULL THEN RAISE EXCEPTION 'missing payment method'; END IF;
  IF cart_row.subtotal < COALESCE(cfg.ordering_min_amount, 0) THEN RAISE EXCEPTION 'below minimum amount'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales WHERE branch_id = bid AND customer_phone = _phone
      AND source = 'whatsapp_bot' AND created_at > now() - interval '60 seconds'
  ) THEN RAISE EXCEPTION 'duplicate order (60s cooldown)'; END IF;
  INSERT INTO public.sales (
    branch_id, subtotal, total, payment_method, customer_name, customer_phone,
    order_type, delivery_address, delivery_neighborhood, delivery_fee,
    status, source, ai_review_status, ai_cart_id, notes
  ) VALUES (
    bid, cart_row.subtotal, cart_row.total, cart_row.payment_method,
    cart_row.customer_name, cart_row.phone, 'domicilio',
    cart_row.delivery_address, cart_row.delivery_neighborhood, cart_row.delivery_fee,
    'pending', 'whatsapp_bot', 'pending_review', cart_row.id, cart_row.delivery_notes
  ) RETURNING id, ticket_number INTO new_sale_id, new_ticket;
  FOR item IN SELECT * FROM jsonb_array_elements(cart_row.items) LOOP
    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, qty, unit_price, modifiers, subtotal, branch_id, notes
    ) VALUES (
      new_sale_id,
      NULLIF(item->>'product_id','')::uuid,
      item->>'product_name',
      COALESCE((item->>'qty')::numeric, 1),
      COALESCE((item->>'unit_price')::numeric, 0),
      COALESCE(item->'modifiers', '[]'::jsonb),
      (COALESCE((item->>'unit_price')::numeric,0)
        + COALESCE((SELECT SUM((m->>'price')::numeric) FROM jsonb_array_elements(COALESCE(item->'modifiers','[]'::jsonb)) m),0)
      ) * COALESCE((item->>'qty')::numeric,1),
      bid, item->>'notes'
    );
  END LOOP;
  UPDATE public.whatsapp_ai_carts
  SET status = 'posted', posted_sale_id = new_sale_id, confirmed_at = now()
  WHERE id = cart_row.id;
  RETURN jsonb_build_object('sale_id', new_sale_id, 'ticket_number', new_ticket, 'total', cart_row.total);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_get(_token text, _phone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid; cart_row public.whatsapp_ai_carts%ROWTYPE;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cart_row FROM public.whatsapp_ai_carts
  WHERE branch_id = bid AND phone = _phone AND status = 'building'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(cart_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_cancel(_token text, _phone text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid uuid;
BEGIN
  bid := public.whatsapp_bot_resolve_branch(_token);
  IF bid IS NULL THEN RETURN false; END IF;
  UPDATE public.whatsapp_ai_carts SET status = 'rejected'
  WHERE branch_id = bid AND phone = _phone AND status = 'building';
  RETURN true;
END;
$$;

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
    'transfer_info', cfg.ordering_transfer_info
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_search_products(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_get_modifiers(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_upsert(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_get(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_cancel(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_ordering_config(text) TO anon, authenticated;
