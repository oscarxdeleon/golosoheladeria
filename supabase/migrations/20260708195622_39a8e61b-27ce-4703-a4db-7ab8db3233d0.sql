INSERT INTO public.role_permissions (role, route_key, allowed)
VALUES ('cajero','llevar-pendientes',true),
       ('admin','llevar-pendientes',true),
       ('mesero','llevar-pendientes',true)
ON CONFLICT (role, route_key) DO UPDATE SET allowed = EXCLUDED.allowed;