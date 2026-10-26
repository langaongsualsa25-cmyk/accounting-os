-- Identity / Tenant domain with Row-Level Security.
-- Blueprint §3 (users and access levels, RBAC + ABAC + tenant_id + RLS),
-- §11 (Identity/Tenant tables), §12 acceptance (company A cannot see B).
--
-- Tenant = one client company. Per Phong's decision (2026-10-26) EVERY table
-- carries tenant_id, including users, roles and permissions:
--   * a person who works for several companies has one users row per
--     company, all linked to the same identity-provider subject (one login);
--   * roles and permissions are provisioned per company by
--     admin.provision_tenant(), so a company admin's changes never touch
--     another company.
-- Only schema_migrations (migration bookkeeping, not readable by app_user)
-- has no tenant_id.
--
-- Request context is set per transaction by the application with
--   set_config('app.subject', <verified JWT sub>, true)
--   set_config('app.tenant_id', <requested company>, true)
-- app.current_tenant_id() returns the requested company only if the caller
-- has an active user row in it, so a wrong header yields no rows anywhere.

create schema app;
revoke all on schema app from public;
grant usage on schema app to app_user;

-- Provisioning functions; never granted to app_user.
create schema admin;
revoke all on schema admin from public;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  -- A company row belongs to itself, so the same tenant_id rule applies.
  tenant_id uuid generated always as (id) stored unique,
  code text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Access levels from blueprint §3, per company.
create table roles (
  tenant_id uuid not null references tenants (id),
  id text not null,
  level int not null check (level between 1 and 4),
  name text not null,
  primary key (tenant_id, id),
  unique (tenant_id, level)
);

create table permissions (
  tenant_id uuid not null references tenants (id),
  id text not null,
  description text not null,
  primary key (tenant_id, id)
);

create table role_permissions (
  tenant_id uuid not null,
  role_id text not null,
  permission_id text not null,
  primary key (tenant_id, role_id, permission_id),
  foreign key (tenant_id, role_id) references roles (tenant_id, id),
  foreign key (tenant_id, permission_id) references permissions (tenant_id, id)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  external_subject text not null, -- identity provider "sub" (Keycloak)
  display_name text not null,
  email text,
  role_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_subject),
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references roles (tenant_id, id)
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

-- Composite foreign keys keep both sides in the same company, so a row can
-- never link a user of company A to a department of company B.
create table user_department_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  granted_at timestamptz not null default now(),
  unique (tenant_id, user_id, department_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id)
);

-- Context functions. SECURITY DEFINER lets them read users/roles without
-- recursing through the policies that call them.
create function app.current_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id
  from users u
  join tenants t on t.id = u.tenant_id
  where u.external_subject = nullif(current_setting('app.subject', true), '')
    and u.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and u.is_active
    and t.status = 'active'
$$;

create function app.current_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from users where id = app.current_user_id()
$$;

-- The caller's companies, used to choose one to work in. Returns only the
-- caller's own memberships; no table policy is widened for this.
create function app.my_memberships()
returns table (tenant_id uuid, code text, name text, role_id text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.code, t.name, u.role_id
  from users u
  join tenants t on t.id = u.tenant_id
  where u.external_subject = nullif(current_setting('app.subject', true), '')
    and u.is_active
    and t.status = 'active'
  order by t.code
$$;

create function app.current_role_level() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select r.level
  from users u
  join roles r on r.tenant_id = u.tenant_id and r.id = u.role_id
  where u.id = app.current_user_id()
$$;

create function app.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from users u
    join role_permissions rp on rp.tenant_id = u.tenant_id and rp.role_id = u.role_id
    where u.id = app.current_user_id() and rp.permission_id = p
  )
$$;

create function app.role_level(r text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select level from roles where tenant_id = app.current_tenant_id() and id = r
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to app_user;

-- Creates a company with the standard role and permission catalogue.
-- Idempotent; run by administrators (migration role) only.
create function admin.provision_tenant(p_id uuid, p_code text, p_name text) returns uuid
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
    (p_id, 'user_access.manage', 'ให้/ถอนสิทธิ์ผู้ใช้ในบริษัท')
  on conflict do nothing;

  insert into role_permissions (tenant_id, role_id, permission_id) values
    (p_id, 'staff', 'department.read'),
    (p_id, 'supervisor', 'department.read'),
    (p_id, 'supervisor', 'user_access.read'),
    (p_id, 'company_admin', 'department.read'),
    (p_id, 'company_admin', 'department.manage'),
    (p_id, 'company_admin', 'user_access.read'),
    (p_id, 'company_admin', 'user_access.manage'),
    (p_id, 'super_admin', 'department.read'),
    (p_id, 'super_admin', 'department.manage'),
    (p_id, 'super_admin', 'user_access.read'),
    (p_id, 'super_admin', 'user_access.manage')
  on conflict do nothing;

  return p_id;
end
$$;
revoke all on function admin.provision_tenant(uuid, text, text) from public;

-- RLS: enabled and forced on every table, all scoped to the current company.
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
alter table user_department_access enable row level security;
alter table user_department_access force row level security;

create policy tenants_read on tenants for select
  using (tenant_id = app.current_tenant_id());
create policy roles_read on roles for select
  using (tenant_id = app.current_tenant_id());
create policy permissions_read on permissions for select
  using (tenant_id = app.current_tenant_id());
create policy role_permissions_read on role_permissions for select
  using (tenant_id = app.current_tenant_id());

-- Users: a company admin manages users of their own company, never above
-- their own level (no self-escalation).
create policy users_read on users for select
  using (tenant_id = app.current_tenant_id());
create policy users_insert on users for insert
  with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('user_access.manage')
    and app.role_level(role_id) <= app.current_role_level()
  );
create policy users_update on users for update
  using (
    tenant_id = app.current_tenant_id()
    and app.has_permission('user_access.manage')
    and app.role_level(role_id) <= app.current_role_level()
  )
  with check (
    tenant_id = app.current_tenant_id()
    and app.role_level(role_id) <= app.current_role_level()
  );

create policy departments_read on departments for select
  using (tenant_id = app.current_tenant_id());
create policy departments_insert on departments for insert
  with check (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'));
create policy departments_update on departments for update
  using (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'))
  with check (tenant_id = app.current_tenant_id());
create policy departments_delete on departments for delete
  using (tenant_id = app.current_tenant_id() and app.has_permission('department.manage'));

create policy uda_read on user_department_access for select
  using (tenant_id = app.current_tenant_id());
create policy uda_insert on user_department_access for insert
  with check (tenant_id = app.current_tenant_id() and app.has_permission('user_access.manage'));
create policy uda_delete on user_department_access for delete
  using (tenant_id = app.current_tenant_id() and app.has_permission('user_access.manage'));

-- Grants. Companies, roles and permissions are provisioned by
-- administrators; users are never hard-deleted (deactivate instead).
grant select on tenants, roles, permissions, role_permissions to app_user;
grant select, insert, update on users to app_user;
grant select, insert, update, delete on departments to app_user;
grant select, insert, delete on user_department_access to app_user;
