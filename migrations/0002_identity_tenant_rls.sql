-- Identity / Tenant domain with Row-Level Security.
-- Blueprint §3 (users and access levels, RBAC + ABAC + tenant_id + RLS),
-- §11 (Identity/Tenant tables), §12 acceptance (company A cannot see B).
--
-- Tenant = one client company. A user is a single global identity that is
-- granted access to one or more tenants through user_tenant_access, so the
-- identity catalogue (tenants, users, roles, permissions, role_permissions)
-- has no tenant_id; it is still protected by RLS. Every table that holds
-- tenant data carries tenant_id and is filtered by app.current_tenant_id().
--
-- Request context is set per transaction by the application with
--   set_config('app.subject', <verified JWT sub>, true)
--   set_config('app.tenant_id', <requested tenant>, true)
-- app.current_tenant_id() only returns the requested tenant if the current
-- user actually has access to it, so a wrong header yields no rows.

create schema app;
revoke all on schema app from public;
grant usage on schema app to app_user;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Access levels from blueprint §3.
create table roles (
  id text primary key,
  level int not null unique check (level between 1 and 4),
  name text not null
);

insert into roles (id, level, name) values
  ('staff', 1, 'Level 1 — Staff'),
  ('supervisor', 2, 'Level 2 — Supervisor'),
  ('company_admin', 3, 'Level 3 — Company Admin'),
  ('super_admin', 4, 'Level 4 — Super Admin');

create table permissions (
  id text primary key,
  description text not null
);

insert into permissions (id, description) values
  ('department.read', 'ดูแผนกในบริษัท'),
  ('department.manage', 'สร้าง/แก้ไข/ลบแผนกในบริษัท'),
  ('user_access.read', 'ดูผู้ใช้และสิทธิ์ในบริษัท'),
  ('user_access.manage', 'ให้/ถอนสิทธิ์ผู้ใช้ในบริษัท');

create table role_permissions (
  role_id text not null references roles (id),
  permission_id text not null references permissions (id),
  primary key (role_id, permission_id)
);

insert into role_permissions (role_id, permission_id) values
  ('staff', 'department.read'),
  ('supervisor', 'department.read'),
  ('supervisor', 'user_access.read'),
  ('company_admin', 'department.read'),
  ('company_admin', 'department.manage'),
  ('company_admin', 'user_access.read'),
  ('company_admin', 'user_access.manage'),
  ('super_admin', 'department.read'),
  ('super_admin', 'department.manage'),
  ('super_admin', 'user_access.read'),
  ('super_admin', 'user_access.manage');

create table users (
  id uuid primary key default gen_random_uuid(),
  external_subject text not null unique, -- identity provider "sub" (Keycloak)
  display_name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table user_tenant_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  role_id text not null references roles (id),
  granted_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Composite foreign keys keep both sides in the same tenant, so a row can
-- never link a user's access in tenant A to a department of tenant B.
create table user_department_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  granted_at timestamptz not null default now(),
  unique (tenant_id, user_id, department_id),
  foreign key (tenant_id, user_id) references user_tenant_access (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id)
);

-- Context functions. SECURITY DEFINER lets them read the access tables
-- without recursing through the policies that call them.
create function app.current_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from users
  where external_subject = nullif(current_setting('app.subject', true), '')
    and is_active
$$;

create function app.current_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select uta.tenant_id
  from user_tenant_access uta
  join tenants t on t.id = uta.tenant_id
  where uta.user_id = app.current_user_id()
    and uta.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and t.status = 'active'
$$;

create function app.accessible_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select uta.tenant_id
  from user_tenant_access uta
  join tenants t on t.id = uta.tenant_id
  where uta.user_id = app.current_user_id() and t.status = 'active'
$$;

-- The caller's own memberships, used to choose a company to work in. Kept
-- out of the user_tenant_access policies so that table stays strictly
-- scoped to the current tenant.
create function app.my_memberships() returns table (tenant_id uuid, role_id text)
language sql stable security definer set search_path = public, pg_temp as $$
  select uta.tenant_id, uta.role_id
  from user_tenant_access uta
  join tenants t on t.id = uta.tenant_id
  where uta.user_id = app.current_user_id() and t.status = 'active'
$$;

create function app.current_role_level() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select r.level
  from user_tenant_access uta
  join roles r on r.id = uta.role_id
  where uta.user_id = app.current_user_id()
    and uta.tenant_id = app.current_tenant_id()
$$;

create function app.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from user_tenant_access uta
    join role_permissions rp on rp.role_id = uta.role_id
    where uta.user_id = app.current_user_id()
      and uta.tenant_id = app.current_tenant_id()
      and rp.permission_id = p
  )
$$;

create function app.role_level(r text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select level from roles where id = r
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to app_user;

-- RLS: enabled and forced on every table.
alter table tenants enable row level security;
alter table tenants force row level security;
alter table roles enable row level security;
alter table roles force row level security;
alter table permissions enable row level security;
alter table permissions force row level security;
alter table role_permissions enable row level security;
alter table role_permissions force row level security;
alter table users enable row level security;
alter table users force row level security;
alter table departments enable row level security;
alter table departments force row level security;
alter table user_tenant_access enable row level security;
alter table user_tenant_access force row level security;
alter table user_department_access enable row level security;
alter table user_department_access force row level security;

-- Global catalogue
create policy tenants_visible on tenants for select
  using (id in (select app.accessible_tenant_ids()));

create policy roles_readable on roles for select using (true);
create policy permissions_readable on permissions for select using (true);
create policy role_permissions_readable on role_permissions for select using (true);

create policy users_visible on users for select
  using (
    id = app.current_user_id()
    or id in (select user_id from user_tenant_access where tenant_id = app.current_tenant_id())
  );

-- Tenant data
create policy departments_tenant_read on departments for select
  using (tenant_id = app.current_tenant_id());
create policy departments_tenant_insert on departments for insert
  with check (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'));
create policy departments_tenant_update on departments for update
  using (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'))
  with check (tenant_id = app.current_tenant_id());
create policy departments_tenant_delete on departments for delete
  using (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'));

-- A user may never grant a role above their own level (no self-escalation).
create policy uta_tenant_read on user_tenant_access for select
  using (tenant_id = app.current_tenant_id());
create policy uta_tenant_insert on user_tenant_access for insert
  with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('user_access.manage')
    and app.role_level(role_id) <= app.current_role_level()
  );
create policy uta_tenant_update on user_tenant_access for update
  using (
    tenant_id = app.current_tenant_id()
    and app.has_permission('user_access.manage')
    and app.role_level(role_id) <= app.current_role_level()
  )
  with check (
    tenant_id = app.current_tenant_id()
    and app.role_level(role_id) <= app.current_role_level()
  );
create policy uta_tenant_delete on user_tenant_access for delete
  using (
    tenant_id = app.current_tenant_id()
    and app.has_permission('user_access.manage')
    and app.role_level(role_id) <= app.current_role_level()
  );

create policy uda_tenant_read on user_department_access for select
  using (tenant_id = app.current_tenant_id());
create policy uda_tenant_insert on user_department_access for insert
  with check (tenant_id = app.current_tenant_id() and app.has_permission('user_access.manage'));
create policy uda_tenant_delete on user_department_access for delete
  using (tenant_id = app.current_tenant_id() and app.has_permission('user_access.manage'));

-- Grants: the catalogue is read-only to the application; tenants and users
-- are provisioned by administrators through the migration/ops role.
grant select on tenants, roles, permissions, role_permissions, users to app_user;
grant select, insert, update, delete on departments, user_tenant_access to app_user;
grant select, insert, delete on user_department_access to app_user;
