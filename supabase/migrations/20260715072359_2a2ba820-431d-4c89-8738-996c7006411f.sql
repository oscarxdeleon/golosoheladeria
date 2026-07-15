
INSERT INTO public.role_permissions (role, route_key, allowed)
SELECT 'supervisor'::public.app_role, k, true
FROM (VALUES
  ('dashboard'),
  ('reportes'),
  ('reportes/resumen'),
  ('reportes/cajas')
) AS v(k)
ON CONFLICT (role, route_key) DO UPDATE SET allowed = EXCLUDED.allowed;
