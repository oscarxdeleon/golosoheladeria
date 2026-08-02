REVOKE ALL ON FUNCTION public.whatsapp_bot_resolve_branch_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_resolve_branch_id(text) TO service_role;