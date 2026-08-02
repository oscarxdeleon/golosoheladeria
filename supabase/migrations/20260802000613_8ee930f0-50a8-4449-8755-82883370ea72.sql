CREATE OR REPLACE FUNCTION public.whatsapp_bot_resolve_branch_id(_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.branch_id
  FROM public.whatsapp_bot_config c
  WHERE c.device_token = btrim(coalesce(_token, ''))
    AND length(btrim(coalesce(_token, ''))) >= 16
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.whatsapp_bot_resolve_branch_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_resolve_branch_id(text) TO anon, authenticated, service_role;