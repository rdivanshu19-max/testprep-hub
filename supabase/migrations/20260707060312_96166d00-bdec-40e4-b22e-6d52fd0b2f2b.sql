ALTER TABLE public.extraction_batches ADD COLUMN IF NOT EXISTS batch_storage_path text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_extraction_jobs_updated_at'
      AND tgrelid = 'public.extraction_jobs'::regclass
  ) THEN
    CREATE TRIGGER update_extraction_jobs_updated_at
    BEFORE UPDATE ON public.extraction_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_extraction_batches_updated_at'
      AND tgrelid = 'public.extraction_batches'::regclass
  ) THEN
    CREATE TRIGGER update_extraction_batches_updated_at
    BEFORE UPDATE ON public.extraction_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;