CREATE POLICY "sales read active delivery shared"
ON public.sales
FOR SELECT
TO authenticated
USING (
  order_type = 'domicilio'
  AND COALESCE(status, 'pending') IN ('pending', 'confirmed', 'ready')
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'cajero')
    OR delivery_user_id = auth.uid()
  )
);

CREATE POLICY "sales update active delivery shared"
ON public.sales
FOR UPDATE
TO authenticated
USING (
  order_type = 'domicilio'
  AND COALESCE(status, 'pending') IN ('pending', 'confirmed', 'ready')
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'cajero')
    OR delivery_user_id = auth.uid()
  )
)
WITH CHECK (
  order_type = 'domicilio'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'cajero')
    OR delivery_user_id = auth.uid()
  )
);

CREATE POLICY "si read active delivery shared"
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.order_type = 'domicilio'
      AND COALESCE(s.status, 'pending') IN ('pending', 'confirmed', 'ready')
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'supervisor')
        OR public.has_role(auth.uid(), 'cajero')
        OR s.delivery_user_id = auth.uid()
      )
  )
);

UPDATE public.sales
SET delivery_status = 'pendiente'
WHERE order_type = 'domicilio'
  AND COALESCE(status, 'pending') IN ('pending', 'confirmed', 'ready')
  AND delivery_status IS NULL;