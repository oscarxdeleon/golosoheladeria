
-- Créditos y abonos
CREATE TABLE public.credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ticket_number integer,
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  balance numeric(12,2) NOT NULL CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','parcial','pagado')),
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credits TO authenticated;
GRANT ALL ON public.credits TO service_role;

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view credits" ON public.credits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert credits" ON public.credits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update credits" ON public.credits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin can delete credits" ON public.credits FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX credits_customer_idx ON public.credits(customer_id, status);
CREATE INDEX credits_branch_idx ON public.credits(branch_id, created_at DESC);

CREATE TRIGGER trg_credits_touch BEFORE UPDATE ON public.credits FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'Efectivo',
  user_id uuid,
  user_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_payments TO authenticated;
GRANT ALL ON public.credit_payments TO service_role;

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view credit_payments" ON public.credit_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert credit_payments" ON public.credit_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admin can delete credit_payments" ON public.credit_payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX credit_payments_credit_idx ON public.credit_payments(credit_id, created_at DESC);

-- RPC: registrar abono
CREATE OR REPLACE FUNCTION public.register_credit_payment(
  _credit_id uuid,
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
  _c public.credits;
  _new_balance numeric;
  _new_status text;
  _pay_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'El valor del abono debe ser mayor a cero'; END IF;
  SELECT * INTO _c FROM public.credits WHERE id = _credit_id FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Crédito no encontrado'; END IF;
  IF _c.status = 'pagado' THEN RAISE EXCEPTION 'El crédito ya fue pagado'; END IF;
  IF _amount > _c.balance + 0.01 THEN RAISE EXCEPTION 'El abono no puede superar el saldo pendiente'; END IF;

  _new_balance := round((_c.balance - _amount)::numeric, 2);
  IF _new_balance <= 0.005 THEN
    _new_balance := 0;
    _new_status := 'pagado';
  ELSE
    _new_status := 'parcial';
  END IF;

  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;

  INSERT INTO public.credit_payments(credit_id, customer_id, branch_id, cash_session_id, amount, payment_method, user_id, user_name, notes)
  VALUES (_c.id, _c.customer_id, _c.branch_id, _cash_session_id, round(_amount::numeric,2), COALESCE(_method,'Efectivo'), _uid, _uname, _notes)
  RETURNING id INTO _pay_id;

  UPDATE public.credits SET balance = _new_balance, status = _new_status WHERE id = _c.id;

  RETURN jsonb_build_object('ok', true, 'payment_id', _pay_id, 'balance', _new_balance, 'status', _new_status);
END;
$$;
