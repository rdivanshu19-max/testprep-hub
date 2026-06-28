DROP TRIGGER IF EXISTS update_extraction_jobs_updated_at ON public.extraction_jobs;
CREATE TRIGGER update_extraction_jobs_updated_at
BEFORE UPDATE ON public.extraction_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_extraction_batches_updated_at ON public.extraction_batches;
CREATE TRIGGER update_extraction_batches_updated_at
BEFORE UPDATE ON public.extraction_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();