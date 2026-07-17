
-- Attempt recovery & per-question notes/tags
ALTER TABLE public.attempt_answers 
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_saved_at timestamptz DEFAULT now();

ALTER TABLE public.test_attempts
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now();

-- Trigger to update last_saved_at on answer changes
CREATE OR REPLACE FUNCTION public.touch_attempt_answer()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.last_saved_at = now();
  UPDATE public.test_attempts SET last_activity_at = now() WHERE id = NEW.attempt_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_attempt_answer ON public.attempt_answers;
CREATE TRIGGER trg_touch_attempt_answer
  BEFORE INSERT OR UPDATE ON public.attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.touch_attempt_answer();

-- Admin audit timeline for test builder
CREATE TABLE IF NOT EXISTS public.test_builder_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  summary text,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.test_builder_audit TO authenticated;
GRANT ALL ON public.test_builder_audit TO service_role;
ALTER TABLE public.test_builder_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit" ON public.test_builder_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write audit" ON public.test_builder_audit
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_test_builder_audit_test ON public.test_builder_audit(test_id, created_at DESC);

-- Allow authenticated users to READ question-images so students can view them
CREATE POLICY "Authenticated read question-images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'question-images');
