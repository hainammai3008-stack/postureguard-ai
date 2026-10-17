-- Extend student feedback to support correct alerts and missed alerts.
-- Metadata only: no image, video, or webcam frame is stored.

alter table public.incorrect_alert_feedback
  add column if not exists feedback_type text not null default 'incorrect_alert';

alter table public.incorrect_alert_feedback
  drop constraint if exists incorrect_alert_feedback_feedback_type_check;

alter table public.incorrect_alert_feedback
  add constraint incorrect_alert_feedback_feedback_type_check
  check (feedback_type in ('correct_alert','incorrect_alert','missed_alert'));

alter table public.incorrect_alert_feedback
  drop constraint if exists incorrect_alert_feedback_posture_check;

alter table public.incorrect_alert_feedback
  add constraint incorrect_alert_feedback_posture_check
  check (posture in ('leaning_left','leaning_right','leaning_backward','leaning_forward','upright','unknown'));

alter table public.incorrect_alert_feedback
  alter column alerted_at drop not null;

create index if not exists incorrect_alert_feedback_type_reported_idx
  on public.incorrect_alert_feedback(feedback_type, reported_at desc);
