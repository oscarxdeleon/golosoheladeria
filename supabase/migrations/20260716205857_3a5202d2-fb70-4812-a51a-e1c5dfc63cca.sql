
-- Make user_id optional (no longer creating dedicated auth users)
ALTER TABLE public.tablet_devices ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.tablet_devices DROP CONSTRAINT IF EXISTS tablet_devices_user_id_fkey;

-- Security-definer RPC so anon can exchange a token for credentials without service_role
CREATE OR REPLACE FUNCTION public.get_tablet_credentials(_token text)
RETURNS TABLE(email text, password text, branch_slug text, branch_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT td.email, td.password, b.slug, b.name
  FROM public.tablet_devices td
  JOIN public.branches b ON b.id = td.branch_id
  WHERE td.token = _token
    AND td.active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_tablet_credentials(text) TO anon, authenticated;

-- Best-effort "last seen" bump also callable by anon
CREATE OR REPLACE FUNCTION public.touch_tablet_last_seen(_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tablet_devices SET last_seen_at = now() WHERE token = _token;
$$;

GRANT EXECUTE ON FUNCTION public.touch_tablet_last_seen(text) TO anon, authenticated;
