CREATE TABLE public.whatsapp_stickers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    label text NOT NULL,
    storage_path text,
    file_url text,
    sort_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_stickers TO authenticated;
GRANT ALL ON public.whatsapp_stickers TO service_role;

ALTER TABLE public.whatsapp_stickers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage stickers"
ON public.whatsapp_stickers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Bot can read active stickers"
ON public.whatsapp_stickers
FOR SELECT
TO service_role
USING (active = true);

CREATE POLICY "Public bot can read active stickers"
ON public.whatsapp_stickers
FOR SELECT
TO anon
USING (active = true);

-- Allow service_role full access to storage.objects for the stickers bucket
CREATE POLICY "Service role can manage stickers objects"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'stickers')
WITH CHECK (bucket_id = 'stickers');

-- Allow authenticated users to upload/delete their own sticker files
CREATE POLICY "Authenticated users can upload stickers"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'stickers');

CREATE POLICY "Authenticated users can delete stickers"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'stickers');

CREATE POLICY "Authenticated users can read stickers"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'stickers');

CREATE OR REPLACE FUNCTION public.update_whatsapp_stickers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_whatsapp_stickers_updated_at
BEFORE UPDATE ON public.whatsapp_stickers
FOR EACH ROW EXECUTE FUNCTION public.update_whatsapp_stickers_updated_at();

-- Seed default stickers (file_url will be updated after upload)
INSERT INTO public.whatsapp_stickers (event_key, label, sort_order, active) VALUES
('welcome', '¡Hola! (bienvenida)', 1, true),
('welcome', '¡Bienvenido!', 2, true),
('thanks', '¡Gracias!', 3, true),
('menu', '¡Qué delicia!', 4, true),
('order_confirmed', '¡Pedido recibido!', 5, true);