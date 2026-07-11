
-- 1) Aperturas y cierres de caja
DROP TRIGGER IF EXISTS trg_audit_cash_sessions ON public.cash_sessions;
CREATE OR REPLACE FUNCTION public.audit_cash_session_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uname text;
BEGIN
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, after, meta)
    VALUES ('cash_session', NEW.id, 'cash_opened', auth.uid(), _uname, NEW.branch_id,
      jsonb_build_object('opening_amount', NEW.opening_amount, 'opened_at', NEW.opened_at),
      jsonb_build_object('opening_notes', NEW.opening_notes));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status = 'closed' THEN
    INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
    VALUES ('cash_session', NEW.id, 'cash_closed', auth.uid(), _uname, NEW.branch_id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status, 'closing_amount', NEW.closing_amount,
        'expected_amount', NEW.expected_amount, 'difference', NEW.difference, 'closed_at', NEW.closed_at),
      jsonb_build_object('closing_notes', NEW.closing_notes));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_audit_cash_sessions AFTER INSERT OR UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.audit_cash_session_changes();

-- 2) Cambios de precio en productos
DROP TRIGGER IF EXISTS trg_audit_product_price ON public.products;
CREATE OR REPLACE FUNCTION public.audit_product_price_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uname text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF COALESCE(NEW.price,0) = COALESCE(OLD.price,0) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES ('product', NEW.id, 'price_updated', auth.uid(), _uname, NULL,
    jsonb_build_object('price', OLD.price), jsonb_build_object('price', NEW.price),
    jsonb_build_object('product_name', NEW.name, 'delta', COALESCE(NEW.price,0) - COALESCE(OLD.price,0)));
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_audit_product_price AFTER UPDATE OF price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.audit_product_price_change();

-- 3) Cambios de propina en ventas
DROP TRIGGER IF EXISTS trg_audit_sale_tip ON public.sales;
CREATE OR REPLACE FUNCTION public.audit_sale_tip_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uname text;
BEGIN
  IF COALESCE(NEW.tip_amount,0) = COALESCE(OLD.tip_amount,0) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name,'Sistema') INTO _uname FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, before, after, meta)
  VALUES ('sale', NEW.id, 'tip_changed', auth.uid(), _uname, NEW.branch_id,
    jsonb_build_object('tip_amount', OLD.tip_amount, 'total', OLD.total),
    jsonb_build_object('tip_amount', NEW.tip_amount, 'total', NEW.total),
    jsonb_build_object('customer_name', NEW.customer_name));
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_audit_sale_tip AFTER UPDATE OF tip_amount ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.audit_sale_tip_change();

-- 4) RPC para reimpresiones
CREATE OR REPLACE FUNCTION public.log_reimpression(_sale_id uuid, _kind text DEFAULT 'ticket', _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _uname text; _sale public.sales;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF _kind NOT IN ('ticket','comanda','cajon','copia') THEN
    RAISE EXCEPTION 'Tipo de reimpresión no válido';
  END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id;
  IF _sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  SELECT COALESCE(full_name,'Usuario') INTO _uname FROM public.profiles WHERE id = _uid;
  INSERT INTO public.audit_log(entity, entity_id, action, user_id, user_name, branch_id, meta)
  VALUES ('sale', _sale.id, 'reimpression', _uid, _uname, _sale.branch_id,
    jsonb_build_object('kind', _kind, 'reason', _reason,
      'customer_name', _sale.customer_name, 'total', _sale.total,
      'ticket_number', _sale.ticket_number));
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.log_reimpression(uuid, text, text) TO authenticated;

-- 5) Intentos fallidos de login
CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text, ip text, user_agent text, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.failed_login_attempts TO authenticated;
GRANT ALL ON public.failed_login_attempts TO service_role;
ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view failed logins" ON public.failed_login_attempts;
CREATE POLICY "Admins can view failed logins" ON public.failed_login_attempts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS failed_login_created_idx ON public.failed_login_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS failed_login_email_idx ON public.failed_login_attempts(email, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_failed_login(_email text, _reason text DEFAULT NULL, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _recent int;
BEGIN
  SELECT COUNT(*) INTO _recent FROM public.failed_login_attempts
    WHERE email = NULLIF(trim(lower(COALESCE(_email,''))),'')
      AND created_at > now() - interval '1 hour';
  IF _recent >= 20 THEN RETURN; END IF;
  INSERT INTO public.failed_login_attempts(email, ip, user_agent, reason)
  VALUES (NULLIF(trim(lower(COALESCE(_email,''))),''), NULLIF(_ip,''),
          NULLIF(_user_agent,''), NULLIF(_reason,''));
END; $$;
GRANT EXECUTE ON FUNCTION public.log_failed_login(text, text, text, text) TO anon, authenticated;

-- 6) Índices de rendimiento en productos
CREATE INDEX IF NOT EXISTS idx_products_active_name ON public.products(active, name);
CREATE INDEX IF NOT EXISTS idx_products_online_name ON public.products(name)
  WHERE active = true AND show_in_online = true;
