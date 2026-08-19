-- patch-v12-bot-metrics.sql
-- Adds bot_metrics table for real-time metrics panel in BotMonitor

CREATE TABLE IF NOT EXISTS public.bot_metrics (
  id              TEXT PRIMARY KEY DEFAULT 'singleton',
  error_rate      NUMERIC NOT NULL DEFAULT 0,
  avg_response_ms NUMERIC NOT NULL DEFAULT 0,
  rate_limit_pct  NUMERIC NOT NULL DEFAULT 0,
  uptime_seconds  BIGINT  NOT NULL DEFAULT 0,
  total_requests  BIGINT  NOT NULL DEFAULT 0,
  total_errors    BIGINT  NOT NULL DEFAULT 0,
  bot_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_metrics_open_access" ON public.bot_metrics;
DROP POLICY IF EXISTS "bot_metrics_select" ON public.bot_metrics;
CREATE POLICY "bot_metrics_select"
  ON public.bot_metrics
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed singleton row so realtime has something to subscribe to
INSERT INTO public.bot_metrics (id, error_rate, avg_response_ms, rate_limit_pct, uptime_seconds, total_requests, total_errors, bot_started_at, updated_at)
VALUES ('singleton', 0, 0, 0, 0, 0, 0, now(), now())
ON CONFLICT (id) DO NOTHING;
