DO $$
DECLARE
  fn regprocedure;
  public_allowlist text[] := ARRAY[
    'create_public_order(jsonb)',
    'create_waiter_call(uuid,text)',
    'get_tablet_credentials(text)',
    'touch_tablet_last_seen(text)',
    'terminal_list_employees(text)',
    'terminal_record_attendance(jsonb)',
    'kds_public_pending(text)',
    'kds_public_mark_item_ready(uuid)',
    'kds_public_mark_all_ready(uuid)',
    'log_failed_login(text,text,text,text)',
    'whatsapp_bot_ack_command(text,text)',
    'whatsapp_bot_ack_outbound(text,uuid[],uuid[],text)',
    'whatsapp_bot_ai_bootstrap(text,text,integer)',
    'whatsapp_bot_ai_cart_cancel(text,text)',
    'whatsapp_bot_ai_cart_confirm(text,text)',
    'whatsapp_bot_ai_cart_get(text,text)',
    'whatsapp_bot_ai_cart_upsert(text,text,jsonb)',
    'whatsapp_bot_ai_context(text,text)',
    'whatsapp_bot_ai_get_modifiers(text,uuid)',
    'whatsapp_bot_ai_history(text,text,integer)',
    'whatsapp_bot_ai_log_event(text,text,text,text,boolean,integer,text,jsonb)',
    'whatsapp_bot_ai_ordering_config(text)',
    'whatsapp_bot_ai_record_reply(text,text)',
    'whatsapp_bot_ai_save_message(text,text,text,text)',
    'whatsapp_bot_ai_search_products(text,text)',
    'whatsapp_bot_enqueue_reply(text,text,text,text)',
    'whatsapp_bot_get_config(text)',
    'whatsapp_bot_get_mode(text)',
    'whatsapp_bot_get_pending(text)',
    'whatsapp_bot_handle_incoming(text,text,text)',
    'whatsapp_bot_handle_incoming(text,text,text,text)',
    'whatsapp_bot_report_outbound_poll(text,text,text,integer,text)',
    'whatsapp_bot_report_status(text,text,text,text,text,text,timestamp with time zone)',
    'whatsapp_bot_resolve_branch_id(text)',
    'whatsapp_bot_resolve_branch(text)',
    'whatsapp_evolution_auth(uuid,text)',
    'whatsapp_evolution_persist(uuid,text,jsonb)'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.oid::regprocedure::text = ANY(public_allowlist))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_get_ai_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_get_ai_keys(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_expire_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_bot_ai_cart_expire_stale() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_ai_key_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_ai_key(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_change_sale_payment_method(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_sale(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_purge_cash_session(uuid,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_ai_key_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_key(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_sale_payment_method(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_sale(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_cash_session(uuid,text) TO authenticated, service_role;