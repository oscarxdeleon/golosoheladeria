-- Permite a cualquier usuario autenticado ver la caja ABIERTA de su sede,
-- para que el guard "Caja cerrada" y Realtime funcionen para meseros,
-- otros cajeros y administradores distintos al que abrió la caja.
CREATE POLICY "Usuarios de la sede ven la caja abierta"
ON public.cash_sessions
FOR SELECT
TO authenticated
USING (
  status = 'open'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
  )
);