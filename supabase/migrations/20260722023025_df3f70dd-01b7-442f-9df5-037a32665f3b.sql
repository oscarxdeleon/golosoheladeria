INSERT INTO public.role_permissions (role, route_key, allowed)
VALUES ('cajero','todos-pedidos',true),('supervisor','todos-pedidos',true),('admin','todos-pedidos',true)
ON CONFLICT (role, route_key) DO UPDATE SET allowed = EXCLUDED.allowed;