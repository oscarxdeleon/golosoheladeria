GRANT EXECUTE ON FUNCTION public.whatsapp_bot_contact_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_get(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_cancel(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_upsert(text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_confirm(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_history(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_save_message(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_enqueue_reply(text, text, text, text) TO anon, authenticated, service_role;