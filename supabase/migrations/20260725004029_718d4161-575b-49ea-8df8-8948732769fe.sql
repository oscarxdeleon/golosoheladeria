CREATE OR REPLACE FUNCTION public.whatsapp_bot_get_stickers(_token text)
RETURNS TABLE (
  id uuid,
  event_key text,
  label text,
  storage_path text,
  sort_order integer,
  active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.event_key,
    s.label,
    s.storage_path,
    s.sort_order,
    s.active
  FROM public.whatsapp_stickers s
  INNER JOIN public.whatsapp_bot_config c ON c.branch_id = s.branch_id
  WHERE c.device_token = _token
    AND s.active = true
  ORDER BY s.event_key, s.sort_order, s.label;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_stickers(text) TO anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_stickers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_stickers(text) TO service_role;