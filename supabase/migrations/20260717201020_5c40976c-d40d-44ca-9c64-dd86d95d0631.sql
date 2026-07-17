-- =========================================
-- WhatsApp Bot V1 — schema
-- =========================================

-- 1) Config del bot por sede
CREATE TABLE public.whatsapp_bot_config (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  welcome_messages text[] NOT NULL DEFAULT ARRAY[
    '¡Hola! 👋 Gracias por escribir a Heladería Goloso. En un momento te atendemos.',
    '¡Hola! 🍨 Bienvenido a Goloso, ¿en qué te podemos ayudar hoy?',
    '¡Hola! 😊 Gracias por contactarnos. Estamos revisando tu mensaje.'
  ],
  menu_triggers text[] NOT NULL DEFAULT ARRAY['menu','menú','carta','pedido','pedir','domicilio','precios'],
  menu_message text NOT NULL DEFAULT 'Mira nuestro menú y pide directamente aquí 👉 {menu_link}',
  connection_status text NOT NULL DEFAULT 'disconnected',
  qr_code text,
  qr_generated_at timestamptz,
  last_seen_at timestamptz,
  device_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  connected_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_bot_config TO authenticated;
GRANT ALL ON public.whatsapp_bot_config TO service_role;
ALTER TABLE public.whatsapp_bot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_bot_config admin/supervisor read"
  ON public.whatsapp_bot_config FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE POLICY "whatsapp_bot_config admin/supervisor write"
  ON public.whatsapp_bot_config FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER trg_whatsapp_bot_config_updated
  BEFORE UPDATE ON public.whatsapp_bot_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Log de mensajes procesados por el bot
CREATE TABLE public.whatsapp_bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  from_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  matched_trigger text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_bot_messages_branch_time
  ON public.whatsapp_bot_messages (branch_id, received_at DESC);

GRANT SELECT, INSERT ON public.whatsapp_bot_messages TO authenticated;
GRANT ALL ON public.whatsapp_bot_messages TO service_role;
ALTER TABLE public.whatsapp_bot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_bot_messages admin/supervisor read"
  ON public.whatsapp_bot_messages FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

-- 3) Tracking de saludos por día (evita repetir bienvenida al mismo número)
CREATE TABLE public.whatsapp_bot_greeted (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  phone text NOT NULL,
  greeted_date date NOT NULL DEFAULT current_date,
  PRIMARY KEY (branch_id, phone, greeted_date)
);

GRANT SELECT, INSERT ON public.whatsapp_bot_greeted TO authenticated;
GRANT ALL ON public.whatsapp_bot_greeted TO service_role;
ALTER TABLE public.whatsapp_bot_greeted ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_bot_greeted admin/supervisor read"
  ON public.whatsapp_bot_greeted FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

-- 4) Semilla: crear config vacía para todas las sedes existentes
INSERT INTO public.whatsapp_bot_config (branch_id)
SELECT id FROM public.branches
ON CONFLICT (branch_id) DO NOTHING;

-- 5) Trigger: al crear sede nueva, crear su config automáticamente
CREATE OR REPLACE FUNCTION public.create_whatsapp_bot_config_for_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.whatsapp_bot_config (branch_id)
  VALUES (NEW.id)
  ON CONFLICT (branch_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_branches_create_whatsapp_config
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.create_whatsapp_bot_config_for_branch();

-- 6) Realtime para que el panel vea el QR y estado al vuelo
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_bot_config;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_bot_messages;
