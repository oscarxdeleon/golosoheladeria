
-- Allow any authenticated user to see OPEN cash sessions (needed for branch-level shift sync to meseros/tablets)
CREATE POLICY "Authenticated ve sesiones abiertas"
  ON public.cash_sessions
  FOR SELECT
  TO authenticated
  USING (status = 'open');

-- Realtime support
ALTER TABLE public.cash_sessions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_sessions;
