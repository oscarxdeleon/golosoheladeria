
-- 1) Cierra duplicadas: mantener solo la más reciente abierta por usuario
UPDATE public.cash_sessions s
SET status='closed', closed_at=now(), closing_notes=COALESCE(closing_notes,'') || ' [auto-cerrada por duplicado]'
WHERE status='open' AND id NOT IN (
  SELECT DISTINCT ON (user_id) id FROM public.cash_sessions WHERE status='open' ORDER BY user_id, opened_at DESC
);

-- 2) Constraint única para evitar duplicados futuros
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status='open';

-- 3) Añadir 'source' y 'customer_phone' / 'customer_name' a sales para distinguir canales de auto-pedido
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pos',
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_phone text;

-- 4) Permitir lectura anónima de catálogo público (menú en línea, kiosko, QR mesa)
GRANT SELECT ON public.categories TO anon;
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.modifier_groups TO anon;
GRANT SELECT ON public.modifiers TO anon;
GRANT SELECT ON public.settings TO anon;
GRANT SELECT ON public.restaurant_tables TO anon;

DROP POLICY IF EXISTS "Public read categories" ON public.categories;
CREATE POLICY "Public read categories" ON public.categories FOR SELECT TO anon USING (active = true);

DROP POLICY IF EXISTS "Public read products" ON public.products;
CREATE POLICY "Public read products" ON public.products FOR SELECT TO anon USING (active = true);

DROP POLICY IF EXISTS "Public read modifier_groups" ON public.modifier_groups;
CREATE POLICY "Public read modifier_groups" ON public.modifier_groups FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read modifiers" ON public.modifiers;
CREATE POLICY "Public read modifiers" ON public.modifiers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read settings" ON public.settings;
CREATE POLICY "Public read settings" ON public.settings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read tables" ON public.restaurant_tables;
CREATE POLICY "Public read tables" ON public.restaurant_tables FOR SELECT TO anon USING (active = true);

-- 5) Permitir a anónimos crear pedidos solo desde canales públicos (kiosk / table_qr / online_menu), siempre 'pending' y sin user_id
GRANT INSERT ON public.sales TO anon;
GRANT INSERT ON public.sale_items TO anon;

DROP POLICY IF EXISTS "Public can create self-orders" ON public.sales;
CREATE POLICY "Public can create self-orders" ON public.sales FOR INSERT TO anon
  WITH CHECK (
    source IN ('kiosk','table_qr','online_menu')
    AND status = 'pending'
    AND user_id IS NULL
  );

DROP POLICY IF EXISTS "Public can add items to self-orders" ON public.sale_items;
CREATE POLICY "Public can add items to self-orders" ON public.sale_items FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_id
        AND s.source IN ('kiosk','table_qr','online_menu')
        AND s.status = 'pending'
    )
  );

-- 6) sales.user_id debe permitir NULL para auto-pedidos
ALTER TABLE public.sales ALTER COLUMN user_id DROP NOT NULL;
