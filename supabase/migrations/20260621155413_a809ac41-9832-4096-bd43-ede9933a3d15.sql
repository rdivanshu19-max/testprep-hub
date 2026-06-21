
CREATE POLICY "Admins read pdf-uploads"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-uploads' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write pdf-uploads"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-uploads' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update pdf-uploads"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pdf-uploads' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete pdf-uploads"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pdf-uploads' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read question-images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'question-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write question-images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update question-images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'question-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete question-images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'question-images' AND public.has_role(auth.uid(), 'admin'));
