
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.attempt_status AS ENUM ('in_progress', 'submitted', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) test_attempts
CREATE TABLE IF NOT EXISTS public.test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  status public.attempt_status NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  time_spent_sec integer NOT NULL DEFAULT 0,
  score numeric,
  total_marks numeric,
  correct_count integer NOT NULL DEFAULT 0,
  incorrect_count integer NOT NULL DEFAULT 0,
  unattempted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_attempts TO authenticated;
GRANT ALL ON public.test_attempts TO service_role;

ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own attempts" ON public.test_attempts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all attempts" ON public.test_attempts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER test_attempts_updated_at BEFORE UPDATE ON public.test_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS test_attempts_user_idx ON public.test_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS test_attempts_test_idx ON public.test_attempts(test_id);

-- 2) attempt_answers
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  chosen_answer text,
  is_correct boolean,
  marked_for_review boolean NOT NULL DEFAULT false,
  time_spent_sec integer NOT NULL DEFAULT 0,
  visited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attempt_answers TO authenticated;
GRANT ALL ON public.attempt_answers TO service_role;

ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own answers" ON public.attempt_answers
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.test_attempts a
    WHERE a.id = attempt_answers.attempt_id AND a.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.test_attempts a
    WHERE a.id = attempt_answers.attempt_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Admins read all answers" ON public.attempt_answers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER attempt_answers_updated_at BEFORE UPDATE ON public.attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS attempt_answers_attempt_idx ON public.attempt_answers(attempt_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.test_attempts;
