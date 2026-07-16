
CREATE TABLE public.tablet_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  password text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tablet_devices TO authenticated;
GRANT ALL ON public.tablet_devices TO service_role;

ALTER TABLE public.tablet_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tablet_devices"
  ON public.tablet_devices FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX tablet_devices_branch_idx ON public.tablet_devices(branch_id);
CREATE INDEX tablet_devices_token_idx ON public.tablet_devices(token);
