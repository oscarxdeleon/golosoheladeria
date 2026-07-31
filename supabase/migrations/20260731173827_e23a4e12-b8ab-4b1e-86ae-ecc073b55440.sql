DROP POLICY IF EXISTS "branch_print_settings_select" ON public.branch_print_settings;
DROP POLICY IF EXISTS "branch_print_settings_insert" ON public.branch_print_settings;
DROP POLICY IF EXISTS "branch_print_settings_update" ON public.branch_print_settings;
DROP POLICY IF EXISTS "branch_print_settings_delete" ON public.branch_print_settings;
DROP POLICY IF EXISTS "Authenticated can view branch print settings" ON public.branch_print_settings;
DROP POLICY IF EXISTS "Authenticated can insert branch print settings" ON public.branch_print_settings;
DROP POLICY IF EXISTS "Authenticated can update branch print settings" ON public.branch_print_settings;
DROP POLICY IF EXISTS "Authenticated can delete branch print settings" ON public.branch_print_settings;

CREATE POLICY "Staff read own branch print settings" ON public.branch_print_settings
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Admins manage branch print settings" ON public.branch_print_settings
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "pr auth read" ON public.printers;
DROP POLICY IF EXISTS "pr auth write" ON public.printers;
DROP POLICY IF EXISTS "Authenticated can view printers" ON public.printers;
DROP POLICY IF EXISTS "Authenticated can manage printers" ON public.printers;
CREATE POLICY "Staff read own branch printers" ON public.printers
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Admins manage printers" ON public.printers
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Auth can view deposits" ON public.cash_deposits;
DROP POLICY IF EXISTS "Authenticated can view deposits" ON public.cash_deposits;
CREATE POLICY "Authorized staff read deposits" ON public.cash_deposits
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);

DROP POLICY IF EXISTS "auth can read print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "auth can insert print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "auth can update print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "auth can delete print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Authenticated can read print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Authenticated can insert print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Authenticated can update print jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "Authenticated can delete print jobs" ON public.print_jobs;
CREATE POLICY "Staff read own branch print jobs" ON public.print_jobs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Staff create own branch print jobs" ON public.print_jobs
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Staff update own branch print jobs" ON public.print_jobs
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Admins delete print jobs" ON public.print_jobs
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));