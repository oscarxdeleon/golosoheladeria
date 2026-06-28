
-- Printers: admin-only read
DROP POLICY IF EXISTS "pr read" ON public.printers;
CREATE POLICY "pr read admin" ON public.printers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Supplies: admin-only read
DROP POLICY IF EXISTS "sup read" ON public.supplies;
CREATE POLICY "sup read admin" ON public.supplies FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Sales: own or admin
DROP POLICY IF EXISTS "sales read all" ON public.sales;
CREATE POLICY "sales read own or admin" ON public.sales FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Sale items: items of own sales or admin
DROP POLICY IF EXISTS "si read" ON public.sale_items;
CREATE POLICY "si read own or admin" ON public.sale_items FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.user_id = auth.uid())
);

-- Revoke EXECUTE on security-definer helpers from client roles
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
