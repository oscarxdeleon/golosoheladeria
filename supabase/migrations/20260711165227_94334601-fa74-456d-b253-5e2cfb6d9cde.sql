
-- =========================================================================
-- 1) profiles: restringir lectura al propio usuario o admin
-- =========================================================================
DROP POLICY IF EXISTS "profiles read all auth" ON public.profiles;
CREATE POLICY "profiles read self or admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 2) customers: restringir por rol (admin/cajero/mesero/domiciliario)
-- =========================================================================
DROP POLICY IF EXISTS "customers auth read" ON public.customers;
DROP POLICY IF EXISTS "customers auth write" ON public.customers;

CREATE POLICY "customers staff read"
  ON public.customers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero') OR
    public.has_role(auth.uid(),'domiciliario')
  );
CREATE POLICY "customers staff insert"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero') OR
    public.has_role(auth.uid(),'domiciliario')
  );
CREATE POLICY "customers staff update"
  ON public.customers FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero')
  );
CREATE POLICY "customers admin delete"
  ON public.customers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- =========================================================================
-- 3) customer_addresses: reemplazar USING(true) por rol
-- =========================================================================
DROP POLICY IF EXISTS "auth read addresses"   ON public.customer_addresses;
DROP POLICY IF EXISTS "auth insert addresses" ON public.customer_addresses;
DROP POLICY IF EXISTS "auth update addresses" ON public.customer_addresses;
DROP POLICY IF EXISTS "auth delete addresses" ON public.customer_addresses;

CREATE POLICY "addresses staff read"
  ON public.customer_addresses FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero') OR
    public.has_role(auth.uid(),'domiciliario')
  );
CREATE POLICY "addresses staff insert"
  ON public.customer_addresses FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero') OR
    public.has_role(auth.uid(),'mesero') OR
    public.has_role(auth.uid(),'domiciliario')
  );
CREATE POLICY "addresses staff update"
  ON public.customer_addresses FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'cajero')
  );
CREATE POLICY "addresses admin delete"
  ON public.customer_addresses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- =========================================================================
-- 4) cash_sessions: eliminar la política que expone sesiones abiertas
-- =========================================================================
DROP POLICY IF EXISTS "Authenticated ve sesiones abiertas" ON public.cash_sessions;

-- =========================================================================
-- 5) Tablas financieras: admin/cajero
-- =========================================================================
-- credits
DROP POLICY IF EXISTS "Authenticated can view credits"   ON public.credits;
DROP POLICY IF EXISTS "Authenticated can insert credits" ON public.credits;
DROP POLICY IF EXISTS "Authenticated can update credits" ON public.credits;

CREATE POLICY "credits staff read"
  ON public.credits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "credits staff insert"
  ON public.credits FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "credits staff update"
  ON public.credits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- credit_payments
DROP POLICY IF EXISTS "Authenticated can view credit_payments"   ON public.credit_payments;
DROP POLICY IF EXISTS "Authenticated can insert credit_payments" ON public.credit_payments;

CREATE POLICY "credit_payments staff read"
  ON public.credit_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "credit_payments staff insert"
  ON public.credit_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- purchases
DROP POLICY IF EXISTS "purchases read auth"   ON public.purchases;
DROP POLICY IF EXISTS "purchases insert auth" ON public.purchases;

CREATE POLICY "purchases staff read"
  ON public.purchases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "purchases staff insert"
  ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'))
    AND (auth.uid() = user_id OR user_id IS NULL)
  );

-- purchase_items
DROP POLICY IF EXISTS "pitems read auth"   ON public.purchase_items;
DROP POLICY IF EXISTS "pitems insert auth" ON public.purchase_items;

CREATE POLICY "pitems staff read"
  ON public.purchase_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "pitems staff insert"
  ON public.purchase_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- expenses
DROP POLICY IF EXISTS "expenses read auth" ON public.expenses;
CREATE POLICY "expenses staff read"
  ON public.expenses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- supplier_credits
DROP POLICY IF EXISTS "auth read supplier_credits"   ON public.supplier_credits;
DROP POLICY IF EXISTS "auth insert supplier_credits" ON public.supplier_credits;
DROP POLICY IF EXISTS "auth update supplier_credits" ON public.supplier_credits;

CREATE POLICY "supplier_credits staff read"
  ON public.supplier_credits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "supplier_credits staff insert"
  ON public.supplier_credits FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "supplier_credits staff update"
  ON public.supplier_credits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- supplier_credit_payments
DROP POLICY IF EXISTS "auth read supplier_credit_payments"   ON public.supplier_credit_payments;
DROP POLICY IF EXISTS "auth insert supplier_credit_payments" ON public.supplier_credit_payments;

CREATE POLICY "supplier_credit_payments staff read"
  ON public.supplier_credit_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));
CREATE POLICY "supplier_credit_payments staff insert"
  ON public.supplier_credit_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'cajero'));

-- =========================================================================
-- 6) attendance_employees / attendance_records: solo admin puede leer
-- =========================================================================
DROP POLICY IF EXISTS "Auth view attendance employees" ON public.attendance_employees;
CREATE POLICY "Admin view attendance employees"
  ON public.attendance_employees FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Auth view records" ON public.attendance_records;
CREATE POLICY "Admin view attendance records"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- =========================================================================
-- 7) attendance_terminals: dejar de exponer coordenadas al público
-- Las terminales usan RPCs SECURITY DEFINER (terminal_list_employees /
-- terminal_record_attendance) por slug, así que no requieren SELECT directo.
-- =========================================================================
DROP POLICY IF EXISTS "Anyone view active terminals" ON public.attendance_terminals;
CREATE POLICY "Staff view active terminals"
  ON public.attendance_terminals FOR SELECT TO authenticated
  USING (active = true);

-- =========================================================================
-- 8) Storage: bucket "attendance"
--    - Eliminar SELECT anónimo
--    - Requerir autenticación para subir
-- =========================================================================
DROP POLICY IF EXISTS "Anon read attendance photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone upload attendance photo" ON storage.objects;

CREATE POLICY "Auth upload attendance photo"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance');

-- =========================================================================
-- 9) SECURITY DEFINER functions: revocar EXECUTE por defecto y otorgar
--    solo a los roles que corresponde.
-- =========================================================================

-- Triggers (no requieren EXECUTE; corren en el contexto del trigger)
REVOKE ALL ON FUNCTION public.apply_purchase_item_to_stock()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cash_session_changes()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_entity_changes()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_product_price_change()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_sale_tip_change()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_create_linked_children()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_create_supplier_credit()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_mark_sale_ready()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_occupy_table_on_sale_item()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_delete_category_in_use()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_delete_product_in_use()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.propagate_product_to_linked_children()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_customer_from_sale()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_modifier_fields_by_name()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_modifier_photo_by_name()           FROM PUBLIC, anon, authenticated;

-- RPCs de aplicación (solo authenticated)
REVOKE ALL ON FUNCTION public.attend_waiter_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attend_waiter_call(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.clone_main_products_to_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_main_products_to_branch(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.close_cash_session(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.close_cash_session_blind(numeric, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session_blind(numeric, numeric, numeric, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_active_cash_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_cash_session(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_by_phone(text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_employee_current_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_current_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.log_reimpression(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_reimpression(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.lookup_customer_loyalty(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_customer_loyalty(text) TO authenticated;

REVOKE ALL ON FUNCTION public.merge_tables(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_tables(uuid, uuid[], text) TO authenticated;

REVOKE ALL ON FUNCTION public.move_table(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_table(uuid, uuid, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.open_cash_session(numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_session(numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_credit_payment(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_credit_payment(uuid, numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_supplier_payment(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment(uuid, numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.release_table(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_table(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resync_product_from_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resync_product_from_parent(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.split_merged_tables(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_merged_tables(uuid, text) TO authenticated;

-- has_role: la usan las políticas RLS bajo cualquier rol (incluye anon)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;

-- RPCs que DEBEN quedar accesibles a anon (kioskos, KDS público, pedidos web, login)
REVOKE ALL ON FUNCTION public.create_public_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_order(jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_waiter_call(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_waiter_call(uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.kds_public_pending(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kds_public_pending(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.kds_public_mark_all_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kds_public_mark_all_ready(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.kds_public_mark_item_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kds_public_mark_item_ready(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.log_failed_login(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_failed_login(text, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.terminal_list_employees(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_list_employees(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.terminal_record_attendance(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_record_attendance(jsonb) TO anon, authenticated;
