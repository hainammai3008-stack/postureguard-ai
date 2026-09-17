-- Add leaning_forward to posture_events after checking the live schema.
-- Run once in Supabase SQL Editor before activating a five-class model.
-- The DO block only replaces an old posture CHECK that names the four
-- existing classes and does not already include leaning_forward.

do $$
declare
  old_constraint record;
begin
  if to_regclass('public.posture_events') is null then
    raise exception 'public.posture_events does not exist';
  end if;

  for old_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.posture_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%leaning_backward%'
      and pg_get_constraintdef(c.oid) like '%leaning_left%'
      and pg_get_constraintdef(c.oid) like '%leaning_right%'
      and pg_get_constraintdef(c.oid) like '%upright%'
      and pg_get_constraintdef(c.oid) not like '%leaning_forward%'
  loop
    execute format('alter table public.posture_events drop constraint %I', old_constraint.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.posture_events'::regclass
      and conname = 'posture_events_posture_five_classes_check'
  ) then
    alter table public.posture_events
      add constraint posture_events_posture_five_classes_check
      check (posture in ('upright', 'leaning_backward', 'leaning_forward', 'leaning_left', 'leaning_right'));
  end if;
end $$;
