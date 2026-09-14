-- PostureGuard AI v6.10
-- Add global confidence threshold to system_config.
-- Run once in Supabase SQL Editor for an existing database.

alter table public.system_config
  add column if not exists confidence_threshold numeric(4,3) not null default 0.500;

update public.system_config
set confidence_threshold = 0.500
where confidence_threshold is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'system_config_confidence_threshold_check'
      and conrelid = 'public.system_config'::regclass
  ) then
    alter table public.system_config
      add constraint system_config_confidence_threshold_check
      check (confidence_threshold > 0 and confidence_threshold <= 1);
  end if;
end $$;
