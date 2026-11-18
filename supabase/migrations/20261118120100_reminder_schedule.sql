-- Hourly tick for the weekly reminder email. The remind function decides who is due
-- (their day, their hour, their time zone) and sends at most one email per person per day.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'tally-remind';
select cron.schedule(
  'tally-remind',
  '7 * * * *',
  $$select net.http_post(
      url := 'https://xklfnsqypmsqvcernpwq.supabase.co/functions/v1/remind',
      body := '{"tick":true}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb
    )$$
);
