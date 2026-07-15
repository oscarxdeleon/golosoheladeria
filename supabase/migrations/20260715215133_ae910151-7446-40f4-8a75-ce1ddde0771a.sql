ALTER TABLE public.branches
ADD COLUMN IF NOT EXISTS schedules jsonb NOT NULL DEFAULT jsonb_build_object(
  'physical', jsonb_build_object(
    'lun', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'mar', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'mie', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'jue', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'vie', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:30'),
    'sab', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:30'),
    'dom', jsonb_build_object('open', true, 'from', '11:00', 'to', '21:00')
  ),
  'online', jsonb_build_object(
    'lun', jsonb_build_object('open', true, 'from', '10:00', 'to', '21:30'),
    'mar', jsonb_build_object('open', true, 'from', '10:00', 'to', '21:30'),
    'mie', jsonb_build_object('open', true, 'from', '10:00', 'to', '21:30'),
    'jue', jsonb_build_object('open', true, 'from', '10:00', 'to', '21:30'),
    'vie', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'sab', jsonb_build_object('open', true, 'from', '10:00', 'to', '22:00'),
    'dom', jsonb_build_object('open', true, 'from', '11:00', 'to', '20:30')
  )
);