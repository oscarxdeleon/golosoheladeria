
CREATE TABLE public.kiosk_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'kiosk',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kiosk_feedback_branch_created_idx ON public.kiosk_feedback(branch_id, created_at DESC);

GRANT SELECT ON public.kiosk_feedback TO anon;
GRANT INSERT, SELECT ON public.kiosk_feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_feedback TO authenticated;
GRANT ALL ON public.kiosk_feedback TO service_role;

ALTER TABLE public.kiosk_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit kiosk feedback"
  ON public.kiosk_feedback FOR INSERT TO anon, authenticated
  WITH CHECK (rating BETWEEN 1 AND 5);

CREATE POLICY "Authenticated users can view kiosk feedback"
  ON public.kiosk_feedback FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins manage kiosk feedback"
  ON public.kiosk_feedback FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
