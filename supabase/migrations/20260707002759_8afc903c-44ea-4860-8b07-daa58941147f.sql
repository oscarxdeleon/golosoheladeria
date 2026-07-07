
CREATE TABLE public.supplier_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  supplier text NOT NULL DEFAULT '',
  invoice_number text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  balance numeric(12,2) NOT NULL CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','parcial','pagado')),
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_credits TO authenticated;
GRANT ALL ON public.supplier_credits TO service_role;

ALTER TABLE public.supplier_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read supplier_credits" ON public.supplier_credits FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert supplier_credits" ON public.supplier_credits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update supplier_credits" ON public.supplier_credits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete supplier_credits" ON public.supplier_credits FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX supplier_credits_supplier_idx ON public.supplier_credits(supplier);
CREATE INDEX supplier_credits_status_idx ON public.supplier_credits(status, created_at DESC);
CREATE TRIGGER trg_supplier_credits_touch BEFORE UPDATE ON public.supplier_credits FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.supplier_credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_credit_id uuid NOT NULL REFERENCES public.supplier_credits(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'Efectivo',
  user_id uuid,
  user_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_credit_payments TO authenticated;
GRANT ALL ON public.supplier_credit_payments TO service_role;

ALTER TABLE public.supplier_credit_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read supplier_credit_payments" ON public.supplier_credit_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert supplier_credit_payments" ON public.supplier_credit_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin delete supplier_credit_payments" ON public.supplier_credit_payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX supplier_credit_payments_credit_idx ON public.supplier_credit_payments(supplier_credit_id, created_at DESC);

-- RPC para registrar pago a proveedor
CREATE OR REPLACE FUNCTION public.register_supplier_payment(
  _supplier_credit_id uuid,
  _amount numeric,
  _method text DEFAULT 'Efectivo',
  _notes text DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _c public.supplier_credits;
  _new_balance numeric;
  _new_status text;
  _pay_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'El valor del pago debe ser mayor a cero'; END IF;
  SELECT * INTO _c FROM public.supplier_credits WHERE id = _supplier_credit_id FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Deuda no encontrada'; END IF;
  IF _c.status = 'pagado' THEN RAISE EXCEPTION 'La deuda ya fue pagada'; END IF;
  IF _amount > _c.balance + 0.01 THEN RAISE EXCEPTION 'El pago no puede superar el saldo pendiente'; END IF;

  _new_balance := round((_c.balance - _amount)::numeric, 2);
  IF _new_balance <= 0.005 THEN
    _new_balance := 0;
    _new_status := 'pagado';
  ELSE
    _new_status := 'parcial';
  END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  INSERT INTO public.supplier_credit_payments(supplier_credit_id, branch_id, cash_session_id, amount, payment_method, user_id, user_name, notes)
  VALUES (_c.id, _c.branch_id, _cash_session_id, round(_amount::numeric,2), COALESCE(_method,'Efectivo'), _uid, _uname, _notes)
  RETURNING id INTO _pay_id;

  UPDATE public.supplier_credits SET balance = _new_balance, status = _new_status WHERE id = _c.id;

  RETURN jsonb_build_object('ok', true, 'payment_id', _pay_id, 'balance', _new_balance, 'status', _new_status);
END;
$$;

-- Trigger: al insertar una compra con payment_method 'crédito', crear la deuda
CREATE OR REPLACE FUNCTION public.auto_create_supplier_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uname text;
BEGIN
  IF lower(COALESCE(NEW.payment_method,'')) NOT IN ('credito','crédito') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_credits WHERE purchase_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(full_name, NEW.user_name, 'Usuario') INTO _uname FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.supplier_credits(purchase_id, supplier, invoice_number, branch_id, total, balance, status, notes, created_by, created_by_name)
  VALUES (NEW.id, COALESCE(NEW.supplier,''), NEW.invoice_number, NEW.branch_id, NEW.total, NEW.total, 'pendiente', NEW.notes, NEW.user_id, COALESCE(_uname, NEW.user_name));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_purchases_auto_credit
AFTER INSERT ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.auto_create_supplier_credit();

-- Permisos de módulo deudas para admin y cajero
INSERT INTO public.role_permissions (role, route_key, allowed)
SELECT r::app_role, 'deudas', true FROM (VALUES ('admin'),('cajero')) AS t(r)
ON CONFLICT DO NOTHING;
