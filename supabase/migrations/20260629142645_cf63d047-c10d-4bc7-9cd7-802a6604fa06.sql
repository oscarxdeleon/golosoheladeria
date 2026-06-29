
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  supplier text,
  invoice_number text,
  payment_method text NOT NULL DEFAULT 'efectivo',
  total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchases read auth" ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "purchases insert auth" ON public.purchases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "purchases admin update" ON public.purchases FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "purchases admin delete" ON public.purchases FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('product','supply')),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  supply_id uuid REFERENCES public.supplies(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity numeric(12,3) NOT NULL,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pitems read auth" ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "pitems insert auth" ON public.purchase_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pitems admin update" ON public.purchase_items FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "pitems admin delete" ON public.purchase_items FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'efectivo',
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses read auth" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "expenses insert auth" ON public.expenses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "expenses admin update" ON public.expenses FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "expenses admin delete" ON public.expenses FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_purchases_branch_created ON public.purchases(branch_id, created_at DESC);
CREATE INDEX idx_expenses_branch_created ON public.expenses(branch_id, created_at DESC);
CREATE INDEX idx_purchases_session ON public.purchases(cash_session_id);
CREATE INDEX idx_expenses_session ON public.expenses(cash_session_id);
CREATE INDEX idx_purchase_items_purchase ON public.purchase_items(purchase_id);

CREATE OR REPLACE FUNCTION public.apply_purchase_item_to_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.item_type = 'product' AND NEW.product_id IS NOT NULL THEN
    UPDATE public.products SET stock = COALESCE(stock,0) + NEW.quantity WHERE id = NEW.product_id;
    INSERT INTO public.inventory_movements(item_type, product_id, movement_type, quantity, reason, user_id)
    VALUES ('product', NEW.product_id, 'entrada', NEW.quantity, 'Compra a proveedor', auth.uid());
  ELSIF NEW.item_type = 'supply' AND NEW.supply_id IS NOT NULL THEN
    UPDATE public.supplies SET stock = COALESCE(stock,0) + NEW.quantity,
      cost = CASE WHEN NEW.unit_cost > 0 THEN NEW.unit_cost ELSE cost END
      WHERE id = NEW.supply_id;
    INSERT INTO public.inventory_movements(item_type, supply_id, movement_type, quantity, reason, user_id)
    VALUES ('supply', NEW.supply_id, 'entrada', NEW.quantity, 'Compra a proveedor', auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_purchase_item_stock
AFTER INSERT ON public.purchase_items
FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_item_to_stock();

CREATE OR REPLACE FUNCTION public.close_cash_session_blind(
  _cash_counted numeric, _nequi_counted numeric, _bancolombia_counted numeric,
  _closing_notes text DEFAULT NULL::text
) RETURNS cash_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _session public.cash_sessions;
  _cash_sales numeric := 0;
  _nequi_sales numeric := 0;
  _banco_sales numeric := 0;
  _cash_out numeric := 0;
  _cash_expected numeric := 0;
  _updated public.cash_sessions;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión para cerrar caja'; END IF;
  IF _cash_counted IS NULL OR _cash_counted < 0
     OR _nequi_counted IS NULL OR _nequi_counted < 0
     OR _bancolombia_counted IS NULL OR _bancolombia_counted < 0 THEN
    RAISE EXCEPTION 'Todos los valores deben ser mayores o iguales a cero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text));

  SELECT * INTO _session FROM public.cash_sessions
   WHERE user_id = _user_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;

  IF _session.id IS NULL THEN RAISE EXCEPTION 'No hay caja abierta para cerrar'; END IF;

  SELECT COALESCE(SUM(CASE WHEN lower(payment_method) = 'efectivo' THEN total ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN lower(payment_method) = 'nequi' THEN total ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN lower(payment_method) = 'bancolombia' THEN total ELSE 0 END), 0)
    INTO _cash_sales, _nequi_sales, _banco_sales
    FROM public.sales
   WHERE user_id = _user_id
     AND COALESCE(status,'completed') <> 'cancelled'
     AND created_at >= _session.opened_at
     AND (_session.branch_id IS NULL OR branch_id = _session.branch_id);

  SELECT COALESCE((SELECT SUM(total) FROM public.purchases
                    WHERE cash_session_id = _session.id AND lower(payment_method)='efectivo'),0)
       + COALESCE((SELECT SUM(amount) FROM public.expenses
                    WHERE cash_session_id = _session.id AND lower(payment_method)='efectivo'),0)
    INTO _cash_out;

  _cash_expected := COALESCE(_session.opening_amount, 0) + _cash_sales - _cash_out;

  UPDATE public.cash_sessions SET
    status = 'closed',
    closed_at = now(),
    counted_amount = round(_cash_counted::numeric, 2),
    expected_amount = round(_cash_expected::numeric, 2),
    difference = round((_cash_counted - _cash_expected)::numeric, 2),
    cash_counted = round(_cash_counted::numeric, 2),
    nequi_counted = round(_nequi_counted::numeric, 2),
    bancolombia_counted = round(_bancolombia_counted::numeric, 2),
    cash_expected = round(_cash_expected::numeric, 2),
    nequi_expected = round(_nequi_sales::numeric, 2),
    bancolombia_expected = round(_banco_sales::numeric, 2),
    cash_difference = round((_cash_counted - _cash_expected)::numeric, 2),
    nequi_difference = round((_nequi_counted - _nequi_sales)::numeric, 2),
    bancolombia_difference = round((_bancolombia_counted - _banco_sales)::numeric, 2),
    closing_notes = _closing_notes
  WHERE id = _session.id
  RETURNING * INTO _updated;

  RETURN _updated;
END;
$function$;

CREATE POLICY "expense receipts read auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts');
CREATE POLICY "expense receipts insert auth" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts');
CREATE POLICY "expense receipts delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts' AND has_role(auth.uid(),'admin'::app_role));
