-- Baseline (blueprint §10, §11).
-- The application connects as app_user, which owns no tables and cannot
-- bypass Row-Level Security. Tables are owned by the migration role.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login nosuperuser nobypassrls noinherit;
  end if;
end
$$;

grant usage on schema public to app_user;
revoke create on schema public from public;
