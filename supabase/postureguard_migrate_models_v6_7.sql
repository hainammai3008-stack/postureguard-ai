-- ============================================================
-- PostureGuard AI v6.7 - Chỉ hỗ trợ 4 model:
-- MobileNetV2, ResNet50, DenseNet121, EfficientNet-B0
--
-- Dùng migration này cho DB ĐÃ chạy schema/migration cũ.
-- Legacy key "cnn" sẽ được chuyển thành "mobilenetv2".
-- ============================================================

begin;

create table if not exists public.app_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- 1) Bỏ constraint cũ trước khi chuyển key
alter table if exists public.system_config
  drop constraint if exists system_config_selected_model_check;

alter table if exists public.model_registry
  drop constraint if exists model_registry_model_key_check;

-- 2) Nếu registry đã có MobileNetV2 cùng version, bỏ bản legacy CNN trùng version.
delete from public.model_registry c
where c.model_key = 'cnn'
  and exists (
    select 1
    from public.model_registry m
    where m.model_key = 'mobilenetv2'
      and m.model_version = c.model_version
  );

-- 3) Chuyển dữ liệu legacy CNN -> MobileNetV2
update public.system_config
set selected_model = 'mobilenetv2', updated_at = now()
where selected_model = 'cnn';

update public.model_registry
set model_key = 'mobilenetv2'
where model_key = 'cnn';

update public.monitor_sessions
set model_key = 'mobilenetv2'
where model_key = 'cnn';

update public.posture_events
set model_key = 'mobilenetv2'
where model_key = 'cnn';

update public.alerts
set model_key = 'mobilenetv2'
where model_key = 'cnn';

update public.reports
set model_key = 'mobilenetv2'
where model_key = 'cnn';

-- 4) Default mới
alter table public.system_config
  alter column selected_model set default 'mobilenetv2';

alter table public.monitor_sessions
  alter column model_key set default 'mobilenetv2';

alter table public.posture_events
  alter column model_key set default 'mobilenetv2';

alter table public.alerts
  alter column model_key set default 'mobilenetv2';

alter table public.reports
  alter column model_key set default 'mobilenetv2';

-- 5) Chỉ cho phép đúng 4 model ở các bảng cấu hình/registry
alter table public.system_config
  add constraint system_config_selected_model_check
  check (selected_model in ('mobilenetv2','resnet50','densenet121','efficientnetb0'));

alter table public.model_registry
  add constraint model_registry_model_key_check
  check (model_key in ('mobilenetv2','resnet50','densenet121','efficientnetb0'));

insert into public.app_migrations(version)
values ('v6.7-four-models')
on conflict (version) do nothing;

commit;
