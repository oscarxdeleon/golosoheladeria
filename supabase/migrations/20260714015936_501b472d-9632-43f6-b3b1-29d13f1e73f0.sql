
-- Permisos para nuevo módulo REPORTES
INSERT INTO public.role_permissions (role, route_key, allowed)
SELECT r.role, k.route_key, (r.role = 'admin')
FROM (VALUES ('admin'::app_role), ('cajero'::app_role), ('mesero'::app_role), ('domiciliario'::app_role)) AS r(role)
CROSS JOIN (VALUES
  ('reportes'),
  ('reportes/resumen'),
  ('reportes/ventas'),
  ('reportes/cajas'),
  ('reportes/auditoria')
) AS k(route_key)
ON CONFLICT (role, route_key) DO NOTHING;

-- Habilitar por defecto la consulta de cierres para cajeros (solo los propios se restringen a nivel de query)
UPDATE public.role_permissions SET allowed = true
WHERE role = 'cajero' AND route_key IN ('reportes', 'reportes/cajas');
