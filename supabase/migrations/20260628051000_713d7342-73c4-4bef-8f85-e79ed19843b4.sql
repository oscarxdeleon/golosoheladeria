CREATE POLICY "products bucket public read"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'products');

CREATE POLICY "products bucket auth insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'products');

CREATE POLICY "products bucket auth update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'products');

CREATE POLICY "products bucket auth delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'products');