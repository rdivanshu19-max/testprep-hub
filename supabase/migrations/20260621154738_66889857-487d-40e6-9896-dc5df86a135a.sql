
-- =========================================================================
-- ENUMS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'student');
CREATE TYPE public.exam_type AS ENUM ('jee_main', 'jee_advanced', 'neet');
CREATE TYPE public.question_type AS ENUM (
  'single_correct', 'multiple_correct', 'integer',
  'matrix_match', 'assertion_reason', 'paragraph'
);
CREATE TYPE public.question_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE public.test_kind AS ENUM ('full', 'subject', 'chapter', 'pyq', 'custom');
CREATE TYPE public.test_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE public.extraction_status AS ENUM (
  'uploaded','splitting','extracting','validating',
  'needs_review','approved','published','failed'
);
CREATE TYPE public.extraction_question_status AS ENUM ('draft','edited','approved','rejected');

-- =========================================================================
-- updated_at helper
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =========================================================================
-- PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  photo_url TEXT,
  phone TEXT,
  target_exam public.exam_type,
  target_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- USER ROLES
-- =========================================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Policies for profiles (use has_role now that it exists)
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Policies for user_roles
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile and assign student role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, photo_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- TAXONOMY: subjects / chapters / topics
-- =========================================================================
CREATE TABLE public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  exam_scope public.exam_type[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subjects TO authenticated, anon;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads subjects" ON public.subjects FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins write subjects" ON public.subjects FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, slug)
);
GRANT SELECT ON public.chapters TO authenticated, anon;
GRANT ALL ON public.chapters TO service_role;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads chapters" ON public.chapters FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins write chapters" ON public.chapters FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  UNIQUE (chapter_id, slug)
);
GRANT SELECT ON public.topics TO authenticated, anon;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads topics" ON public.topics FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins write topics" ON public.topics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- QUESTIONS (publish target)
-- =========================================================================
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  chapter_id UUID REFERENCES public.chapters(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  type public.question_type NOT NULL DEFAULT 'single_correct',
  difficulty public.question_difficulty NOT NULL DEFAULT 'medium',
  question_text TEXT NOT NULL,
  question_image_url TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  correct_answer TEXT NOT NULL,
  solution_text TEXT,
  solution_video_url TEXT,
  source TEXT,
  pyq_year INT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Students read published questions" ON public.questions FOR SELECT TO authenticated
  USING (is_published = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage questions" ON public.questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.question_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'inline',
  order_index INT NOT NULL DEFAULT 0
);
GRANT SELECT ON public.question_images TO authenticated;
GRANT ALL ON public.question_images TO service_role;
ALTER TABLE public.question_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed reads question images" ON public.question_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage question images" ON public.question_images FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- TESTS (publish target)
-- =========================================================================
CREATE TABLE public.tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  exam public.exam_type NOT NULL,
  kind public.test_kind NOT NULL DEFAULT 'full',
  duration_min INT NOT NULL DEFAULT 180,
  marking_scheme JSONB NOT NULL DEFAULT '{"correct":4,"incorrect":-1,"unattempted":0}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  status public.test_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  extraction_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tests TO authenticated;
GRANT ALL ON public.tests TO service_role;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tests_updated_at BEFORE UPDATE ON public.tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Students read published tests" ON public.tests FOR SELECT TO authenticated
  USING (status = 'published' OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage tests" ON public.tests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  section TEXT,
  order_index INT NOT NULL DEFAULT 0,
  marks_override JSONB,
  UNIQUE (test_id, question_id)
);
GRANT SELECT ON public.test_questions TO authenticated;
GRANT ALL ON public.test_questions TO service_role;
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read test_questions of published tests" ON public.test_questions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.status = 'published')
  );
CREATE POLICY "Admins manage test_questions" ON public.test_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- EXTRACTION PIPELINE (admin-only)
-- =========================================================================
CREATE TABLE public.extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  title TEXT,
  exam public.exam_type,
  page_count INT,
  expected_question_count INT,
  status public.extraction_status NOT NULL DEFAULT 'uploaded',
  extraction_score INT,
  last_error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_jobs TO authenticated;
GRANT ALL ON public.extraction_jobs TO service_role;
ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_extraction_jobs_updated_at BEFORE UPDATE ON public.extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Admins manage extraction jobs" ON public.extraction_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.tests
  ADD CONSTRAINT tests_extraction_job_fk FOREIGN KEY (extraction_job_id)
  REFERENCES public.extraction_jobs(id) ON DELETE SET NULL;

CREATE TABLE public.extraction_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  image_storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, page_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_pages TO authenticated;
GRANT ALL ON public.extraction_pages TO service_role;
ALTER TABLE public.extraction_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage extraction pages" ON public.extraction_pages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.extraction_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  page_from INT NOT NULL,
  page_to INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  raw_response JSONB,
  parsed JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, page_from, page_to)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_batches TO authenticated;
GRANT ALL ON public.extraction_batches TO service_role;
ALTER TABLE public.extraction_batches ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_extraction_batches_updated_at BEFORE UPDATE ON public.extraction_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Admins manage extraction batches" ON public.extraction_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.extraction_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.extraction_batches(id) ON DELETE SET NULL,
  question_number INT NOT NULL,
  source_page INT,
  type public.question_type NOT NULL DEFAULT 'single_correct',
  subject TEXT,
  question_text TEXT NOT NULL DEFAULT '',
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  answer TEXT,
  has_image BOOLEAN NOT NULL DEFAULT false,
  image_storage_path TEXT,
  status public.extraction_question_status NOT NULL DEFAULT 'draft',
  validation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, question_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_questions TO authenticated;
GRANT ALL ON public.extraction_questions TO service_role;
ALTER TABLE public.extraction_questions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_extraction_questions_updated_at BEFORE UPDATE ON public.extraction_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Admins manage extraction questions" ON public.extraction_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.extraction_validation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  missing_numbers INT[] NOT NULL DEFAULT '{}',
  duplicates INT[] NOT NULL DEFAULT '{}',
  broken_options INT[] NOT NULL DEFAULT '{}',
  empty_questions INT[] NOT NULL DEFAULT '{}',
  broken_equations INT[] NOT NULL DEFAULT '{}',
  invalid_json BOOLEAN NOT NULL DEFAULT false,
  score INT,
  raw JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_validation_reports TO authenticated;
GRANT ALL ON public.extraction_validation_reports TO service_role;
ALTER TABLE public.extraction_validation_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage validation reports" ON public.extraction_validation_reports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.extraction_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.extraction_jobs(id) ON DELETE CASCADE,
  actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.extraction_audit_log TO authenticated;
GRANT ALL ON public.extraction_audit_log TO service_role;
ALTER TABLE public.extraction_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit log" ON public.extraction_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write audit log" ON public.extraction_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helpful indexes
CREATE INDEX idx_chapters_subject ON public.chapters(subject_id);
CREATE INDEX idx_topics_chapter ON public.topics(chapter_id);
CREATE INDEX idx_questions_subject ON public.questions(subject_id);
CREATE INDEX idx_test_questions_test ON public.test_questions(test_id, order_index);
CREATE INDEX idx_extraction_pages_job ON public.extraction_pages(job_id, page_number);
CREATE INDEX idx_extraction_batches_job ON public.extraction_batches(job_id);
CREATE INDEX idx_extraction_questions_job ON public.extraction_questions(job_id, question_number);
