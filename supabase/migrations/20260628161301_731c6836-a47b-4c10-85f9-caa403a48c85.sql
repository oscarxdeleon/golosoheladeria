
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_cash_session_idx ON public.sales(cash_session_id);

-- Permitir que el cajero actualice su propio pedido (pendiente -> pagado)
DROP POLICY IF EXISTS "sales update own" ON public.sales;
CREATE POLICY "sales update own" ON public.sales
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(),'admin'));
