CREATE OR REPLACE FUNCTION public.whatsapp_bot_validate_cart_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_qty numeric;
  v_price numeric;
BEGIN
  IF NEW.status <> 'building' THEN RETURN NEW; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb))
  LOOP
    IF coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'invalid product id';
    END IF;
    SELECT * INTO v_product FROM public.products
     WHERE id = (v_item->>'product_id')::uuid
       AND active = true
       AND (branch_id IS NULL OR branch_id = NEW.branch_id)
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'product unavailable'; END IF;
    v_qty := greatest(1, coalesce((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1));
    v_price := v_product.price;
    v_item := v_item || jsonb_build_object('unit_price', v_price, 'product_name', v_product.name, 'quantity', v_qty);
    v_items := v_items || jsonb_build_array(v_item);
    v_subtotal := v_subtotal + v_price * v_qty;
  END LOOP;
  NEW.items := v_items;
  NEW.subtotal := v_subtotal;
  NEW.total := v_subtotal + coalesce(NEW.delivery_fee, 0);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_bot_validate_cart_prices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_validate_cart_prices() TO service_role;
DROP TRIGGER IF EXISTS whatsapp_bot_validate_cart_prices_trigger ON public.whatsapp_ai_carts;
CREATE TRIGGER whatsapp_bot_validate_cart_prices_trigger
BEFORE INSERT OR UPDATE OF items, status ON public.whatsapp_ai_carts
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_bot_validate_cart_prices();