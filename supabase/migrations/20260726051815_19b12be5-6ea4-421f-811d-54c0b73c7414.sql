CREATE OR REPLACE FUNCTION public.whatsapp_bot_ai_cart_expire_stale()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.whatsapp_ai_carts
  SET status = 'expired', updated_at = now(), expires_at = coalesce(expires_at, now())
  WHERE status = 'building'
    AND coalesce(expires_at, updated_at + interval '45 minutes') <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

UPDATE public.whatsapp_ai_carts
SET expires_at = greatest(coalesce(expires_at, now()), now() + interval '45 minutes'),
    updated_at = now()
WHERE status = 'building'
  AND jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0
  AND coalesce(customer_name, '') = ''
  AND coalesce(expires_at, now()) <= now() + interval '5 minutes';