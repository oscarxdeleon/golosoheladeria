
CREATE POLICY "Anyone upload attendance photo" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'attendance');
CREATE POLICY "Authenticated read attendance photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance');
CREATE POLICY "Anon read attendance photos" ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'attendance');
CREATE POLICY "Admins manage attendance photos" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'attendance' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'attendance' AND public.has_role(auth.uid(),'admin'));
