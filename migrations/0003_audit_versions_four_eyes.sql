-- Immutable audit log, version history and four-eyes change requests.
-- Blueprint §1 ข้อห้าม (no overwrite without version + audit; the editor may
-- not approve the same item), §6 (Version Control, Four-Eyes Review,
-- Immutable Audit), §11 (audit_logs, approvals, rejections), §12 acceptance
-- (every change shows old value, new value, editor, reason, approver, time).
--
-- Audit rows are written only by SECURITY DEFINER functions/triggers:
-- app_user has no INSERT/UPDATE/DELETE on audit_logs, and triggers reject
-- UPDATE/DELETE/TRUNCATE for every role, including the table owner. Each
-- company's log is a SHA-256 hash chain, so an edit made by bypassing the
-- triggers is detected by app.verify_audit_chain().

-- Custom SQLSTATEs mapped to HTTP by the API:
--   AO403 forbidden action, AO409 invalid state transition.

-- ---------------------------------------------------------------- audit_logs
create table audit_logs (
  id bigserial primary key,
  tenant_id uuid not null references tenants (id),
  seq bigint not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,              -- null = system/administrator action
  actor_subject text,
  action text not null,            -- insert | update | delete | <domain event>
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  prev_hash bytea,
  hash bytea not null,
  unique (tenant_id, seq)
);

create function app.audit_hash(a audit_logs) returns bytea
language sql immutable set search_path = public, pg_temp as $$
  select digest(
    concat_ws('|',
      a.tenant_id::text,
      a.seq::text,
      ((extract(epoch from a.occurred_at) * 1000000)::bigint)::text,
      coalesce(a.actor_user_id::text, ''),
      coalesce(a.actor_subject, ''),
      a.action,
      a.entity_type,
      coalesce(a.entity_id, ''),
      coalesce(a.before_data::text, ''),
      coalesce(a.after_data::text, ''),
      coalesce(a.reason, ''),
      coalesce(encode(a.prev_hash, 'hex'), '')
    ),
    'sha256')
$$;

-- Fills seq, actor, prev_hash and hash. Serialised per company so the
-- chain has no gaps or forks under concurrent writes.
create function app.audit_logs_chain() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  last audit_logs;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit:' || new.tenant_id::text, 0));
  select * into last from audit_logs where tenant_id = new.tenant_id order by seq desc limit 1;
  new.seq := coalesce(last.seq, 0) + 1;
  new.prev_hash := last.hash;
  new.occurred_at := clock_timestamp();
  new.actor_user_id := app.current_user_id();
  new.actor_subject := nullif(current_setting('app.subject', true), '');
  new.hash := app.audit_hash(new);
  return new;
end
$$;

create trigger audit_logs_chain before insert on audit_logs
  for each row execute function app.audit_logs_chain();

create function app.reject_modification() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'AO403';
end
$$;

create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function app.reject_modification();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function app.reject_modification();

-- Returns the first seq whose hash or link does not verify, or null.
create function app.verify_audit_chain(p_tenant uuid) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r audit_logs;
  expected_prev bytea := null;
  expected_seq bigint := 1;
begin
  for r in select * from audit_logs where tenant_id = p_tenant order by seq loop
    if r.seq <> expected_seq
       or r.prev_hash is distinct from expected_prev
       or r.hash <> app.audit_hash(r) then
      return r.seq;
    end if;
    expected_prev := r.hash;
    expected_seq := expected_seq + 1;
  end loop;
  return null;
end
$$;

-- Explicit domain events (e.g. approve/reject) with an optional reason.
create function app.write_audit(
  p_tenant uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_reason text
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into audit_logs (tenant_id, action, entity_type, entity_id, before_data, after_data, reason, hash)
  values (p_tenant, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, ''::bytea)
$$;

-- Generic row-change audit. The reason comes from the transaction-local
-- setting app.change_reason.
create function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rec_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  rec_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec jsonb := coalesce(rec_new, rec_old);
begin
  perform app.write_audit(
    (rec ->> 'tenant_id')::uuid,
    lower(tg_op),
    tg_table_name,
    rec ->> 'id',
    rec_old,
    rec_new,
    nullif(current_setting('app.change_reason', true), ''));
  return null;
end
$$;

create trigger departments_audit after insert or update or delete on departments
  for each row execute function app.audit_row_change();
create trigger users_audit after insert or update or delete on users
  for each row execute function app.audit_row_change();
create trigger user_department_access_audit after insert or update or delete on user_department_access
  for each row execute function app.audit_row_change();

-- ------------------------------------------------------------- change_requests
-- Four-eyes: a proposed change to important data is approved or rejected by
-- someone other than the person who proposed it (CHECK below).
create table change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  entity_type text not null,
  entity_id uuid,
  base_version int,
  proposed jsonb not null,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  unique (tenant_id, id),
  foreign key (tenant_id, requested_by) references users (tenant_id, id),
  foreign key (tenant_id, decided_by) references users (tenant_id, id),
  constraint four_eyes check (decided_by is null or decided_by <> requested_by),
  constraint decided_iff_closed check ((status = 'pending') = (decided_by is null and decided_at is null))
);

create function app.change_requests_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' then
    if me is null and current_setting('app.subject', true) is not null
       and current_setting('app.subject', true) <> '' then
      raise exception 'unknown user' using errcode = 'AO403';
    end if;
    new.requested_by := coalesce(me, new.requested_by);
    new.requested_at := now();
    if new.status <> 'pending' or new.decided_by is not null then
      raise exception 'a change request starts as pending' using errcode = 'AO409';
    end if;
    return new;
  end if;

  -- UPDATE: only a decision on a pending request; the request itself is frozen.
  if old.status <> 'pending' then
    raise exception 'change request % is already %', old.id, old.status using errcode = 'AO409';
  end if;
  if (new.tenant_id, new.entity_type, new.entity_id, new.base_version, new.proposed, new.reason,
      new.requested_by, new.requested_at)
     is distinct from
     (old.tenant_id, old.entity_type, old.entity_id, old.base_version, old.proposed, old.reason,
      old.requested_by, old.requested_at) then
    raise exception 'a change request cannot be edited; create a new one' using errcode = 'AO409';
  end if;
  if new.status = 'cancelled' then
    if me is distinct from old.requested_by then
      raise exception 'only the requester can cancel' using errcode = 'AO403';
    end if;
  elsif new.status in ('approved', 'rejected') then
    if me = old.requested_by then
      raise exception 'four-eyes: the requester cannot decide their own change' using errcode = 'AO403';
    end if;
    if not app.has_permission('change.approve') then
      raise exception 'missing permission change.approve' using errcode = 'AO403';
    end if;
  else
    raise exception 'invalid status %', new.status using errcode = 'AO409';
  end if;
  new.decided_by := me;
  new.decided_at := now();
  return new;
end
$$;

create trigger change_requests_guard before insert or update on change_requests
  for each row execute function app.change_requests_guard();
create trigger change_requests_no_delete before delete or truncate on change_requests
  for each statement execute function app.reject_modification();
create trigger change_requests_audit after insert or update on change_requests
  for each row execute function app.audit_row_change();

-- ------------------------------------------------------------- record_versions
-- Full snapshot of each approved version of an important record. Rows are
-- immutable except closing effective_to once when the next version starts.
create table record_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  entity_type text not null,
  entity_id uuid not null,
  version int not null check (version >= 1),
  data jsonb not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  change_request_id uuid,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, entity_type, entity_id, version),
  foreign key (tenant_id, change_request_id) references change_requests (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id),
  foreign key (tenant_id, approved_by) references users (tenant_id, id),
  constraint four_eyes check (approved_by is null or created_by is null or approved_by <> created_by),
  check (effective_to is null or effective_to >= effective_from)
);

create function app.record_versions_guard() returns trigger
language plpgsql as $$
begin
  if old.effective_to is null and new.effective_to is not null
     and (to_jsonb(new) - 'effective_to') = (to_jsonb(old) - 'effective_to') then
    return new;
  end if;
  raise exception 'record_versions is immutable (only effective_to may be closed once)'
    using errcode = 'AO403';
end
$$;

create trigger record_versions_guard before update on record_versions
  for each row execute function app.record_versions_guard();
create trigger record_versions_no_delete before delete or truncate on record_versions
  for each statement execute function app.reject_modification();
create trigger record_versions_audit after insert or update on record_versions
  for each row execute function app.audit_row_change();

-- ------------------------------------------------------------- RLS + grants
alter table audit_logs enable row level security;
alter table audit_logs force row level security;
alter table change_requests enable row level security;
alter table change_requests force row level security;
alter table record_versions enable row level security;
alter table record_versions force row level security;

create policy audit_logs_read on audit_logs for select
  using (tenant_id = app.current_tenant_id() and app.has_permission('audit.read'));

create policy change_requests_read on change_requests for select
  using (tenant_id = app.current_tenant_id());
create policy change_requests_insert on change_requests for insert
  with check (tenant_id = app.current_tenant_id() and app.has_permission('change.request'));
create policy change_requests_update on change_requests for update
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

create policy record_versions_read on record_versions for select
  using (tenant_id = app.current_tenant_id());
create policy record_versions_insert on record_versions for insert
  with check (tenant_id = app.current_tenant_id() and created_by = app.current_user_id());
create policy record_versions_update on record_versions for update
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

grant select on audit_logs to app_user;
grant select, insert, update on change_requests to app_user;
grant select, insert, update (effective_to) on record_versions to app_user;

revoke all on all functions in schema app from public;
grant execute on function
  app.current_user_id(), app.current_tenant_id(), app.my_memberships(),
  app.current_role_level(), app.has_permission(text), app.role_level(text),
  app.verify_audit_chain(uuid)
to app_user;

-- ---------------------------------------------- permissions for new features
create or replace function admin.provision_tenant(p_id uuid, p_code text, p_name text) returns uuid
language plpgsql as $$
begin
  insert into tenants (id, code, name) values (p_id, p_code, p_name)
  on conflict (id) do nothing;

  insert into roles (tenant_id, id, level, name) values
    (p_id, 'staff', 1, 'Level 1 — Staff'),
    (p_id, 'supervisor', 2, 'Level 2 — Supervisor'),
    (p_id, 'company_admin', 3, 'Level 3 — Company Admin'),
    (p_id, 'super_admin', 4, 'Level 4 — Super Admin')
  on conflict do nothing;

  insert into permissions (tenant_id, id, description) values
    (p_id, 'department.read', 'ดูแผนกในบริษัท'),
    (p_id, 'department.manage', 'สร้าง/แก้ไข/ลบแผนกในบริษัท'),
    (p_id, 'user_access.read', 'ดูผู้ใช้และสิทธิ์ในบริษัท'),
    (p_id, 'user_access.manage', 'ให้/ถอนสิทธิ์ผู้ใช้ในบริษัท'),
    (p_id, 'change.request', 'เสนอแก้ไขข้อมูลสำคัญ'),
    (p_id, 'change.approve', 'อนุมัติ/ตีกลับการแก้ไขข้อมูลสำคัญ (ต้องไม่ใช่ผู้เสนอ)'),
    (p_id, 'audit.read', 'ดู Audit Log ของบริษัท')
  on conflict do nothing;

  insert into role_permissions (tenant_id, role_id, permission_id)
  select p_id, rp.role_id, rp.permission_id
  from (values
    ('staff', 'department.read'),
    ('staff', 'change.request'),
    ('supervisor', 'department.read'),
    ('supervisor', 'user_access.read'),
    ('supervisor', 'change.request'),
    ('supervisor', 'change.approve'),
    ('supervisor', 'audit.read'),
    ('company_admin', 'department.read'),
    ('company_admin', 'department.manage'),
    ('company_admin', 'user_access.read'),
    ('company_admin', 'user_access.manage'),
    ('company_admin', 'change.request'),
    ('company_admin', 'change.approve'),
    ('company_admin', 'audit.read'),
    ('super_admin', 'department.read'),
    ('super_admin', 'department.manage'),
    ('super_admin', 'user_access.read'),
    ('super_admin', 'user_access.manage'),
    ('super_admin', 'change.request'),
    ('super_admin', 'change.approve'),
    ('super_admin', 'audit.read')
  ) as rp (role_id, permission_id)
  on conflict do nothing;

  return p_id;
end
$$;
revoke all on function admin.provision_tenant(uuid, text, text) from public;

-- Bring existing companies up to the new catalogue.
select admin.provision_tenant(id, code, name) from tenants;
