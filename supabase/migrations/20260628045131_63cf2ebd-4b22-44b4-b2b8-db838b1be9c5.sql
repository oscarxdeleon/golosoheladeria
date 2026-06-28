
CREATE POLICY "logos read auth" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'logos');
CREATE POLICY "logos admin write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos' AND has_role(auth.uid(),'admin'));
CREATE POLICY "logos admin update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'logos' AND has_role(auth.uid(),'admin'));
CREATE POLICY "logos admin delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'logos' AND has_role(auth.uid(),'admin'));
