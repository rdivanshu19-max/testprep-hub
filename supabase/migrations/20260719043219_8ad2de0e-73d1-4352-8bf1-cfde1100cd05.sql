
ALTER TABLE public.test_attempts
  ADD COLUMN IF NOT EXISTS tab_switches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS focus_losses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fullscreen_exits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proctoring_events jsonb NOT NULL DEFAULT '[]'::jsonb;
