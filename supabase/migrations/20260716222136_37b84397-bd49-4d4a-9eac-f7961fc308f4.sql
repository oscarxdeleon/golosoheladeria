CREATE POLICY "profiles supervisor read"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "roles supervisor read"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'supervisor'));