
-- Funciones RPC del sistema antiguo
DROP FUNCTION IF EXISTS public.admin_create_supervisor_rpc(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_supervisor_rpc(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_supervisors_rpc() CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_supervisor_rpc(uuid, text, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.create_supervisor_account_rpc(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.delete_supervisor_account_rpc(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.list_supervisor_accounts_rpc() CASCADE;
DROP FUNCTION IF EXISTS public.list_supervisor_audit_rpc() CASCADE;
DROP FUNCTION IF EXISTS public.require_supervisor_session_rpc(text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_cash_session_detail_v2_rpc(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_cash_sessions_list_rpc(text, uuid, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_dashboard_rpc(text, uuid, boolean, date) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_dashboard_v2_rpc(text, uuid, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_hash_pin(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_login_by_name_rpc(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_login_rpc(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_logout_rpc(text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_session_detail_rpc(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_slug(text) CASCADE;
DROP FUNCTION IF EXISTS public.supervisor_validate_session_rpc(text) CASCADE;
DROP FUNCTION IF EXISTS public.update_supervisor_account_rpc(uuid, text, text, boolean, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.update_supervisor_accounts_updated_at() CASCADE;

-- Tablas del sistema antiguo
DROP TABLE IF EXISTS public.supervisor_audit_log CASCADE;
DROP TABLE IF EXISTS public.supervisor_sessions CASCADE;
DROP TABLE IF EXISTS public.supervisor_accounts CASCADE;
