-- SANDBOX SEED — ข้อมูลสมมติทั้งหมด ไม่ใช่ข้อมูลลูกค้าจริง
-- Fictional data only (project rule 4). Fixed UUIDs keep the seed idempotent.
-- Prefix 00000000-0000-4000-8000- marks seed rows.

select admin.provision_tenant('00000000-0000-4000-8000-00000000000a', 'DEMO-A', 'บริษัท ตัวอย่าง เอ จำกัด (ข้อมูลสมมติ)');
select admin.provision_tenant('00000000-0000-4000-8000-00000000000b', 'DEMO-B', 'บริษัท ตัวอย่าง บี จำกัด (ข้อมูลสมมติ)');

-- seed-shared-supervisor works for both companies: one users row per company,
-- same login subject.
insert into users (id, tenant_id, external_subject, display_name, email, role_id) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000000a', 'seed-staff-a', 'พนักงานสมมติ เอ', 'staff-a@example.invalid', 'staff'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000000a', 'seed-supervisor-a', 'หัวหน้าสมมติ เอ', 'supervisor-a@example.invalid', 'supervisor'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-00000000000a', 'seed-admin-a', 'แอดมินสมมติ เอ', 'admin-a@example.invalid', 'company_admin'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-00000000000a', 'seed-shared-supervisor', 'หัวหน้าสมมติ ดูแลสองบริษัท', 'shared@example.invalid', 'supervisor'),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-00000000000b', 'seed-staff-b', 'พนักงานสมมติ บี', 'staff-b@example.invalid', 'staff'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-00000000000b', 'seed-admin-b', 'แอดมินสมมติ บี', 'admin-b@example.invalid', 'company_admin'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-00000000000b', 'seed-shared-supervisor', 'หัวหน้าสมมติ ดูแลสองบริษัท', 'shared@example.invalid', 'supervisor')
on conflict (id) do nothing;

insert into departments (id, tenant_id, code, name) values
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-00000000000a', 'ACC', 'บัญชี'),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-00000000000a', 'TAX', 'ภาษี'),
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-00000000000b', 'ACC', 'บัญชี'),
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-00000000000b', 'TAX', 'ภาษี')
on conflict (id) do nothing;

insert into user_department_access (tenant_id, user_id, department_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000a0001'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-0000000b0001')
on conflict do nothing;

-- Four-eyes and version history examples (fictional).
insert into change_requests (id, tenant_id, entity_type, entity_id, proposed, reason, requested_by) values
  ('00000000-0000-4000-8000-0000000ac001', '00000000-0000-4000-8000-00000000000a', 'department',
   '00000000-0000-4000-8000-0000000a0002', '{"name": "ภาษีอากร"}', 'ตัวอย่าง: ขอเปลี่ยนชื่อแผนก',
   '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-0000000bc001', '00000000-0000-4000-8000-00000000000b', 'department',
   '00000000-0000-4000-8000-0000000b0002', '{"name": "ภาษีอากร"}', 'ตัวอย่าง: ขอเปลี่ยนชื่อแผนก',
   '00000000-0000-4000-8000-000000000201')
on conflict (id) do nothing;

insert into record_versions (id, tenant_id, entity_type, entity_id, version, data, created_by) values
  ('00000000-0000-4000-8000-0000000ae001', '00000000-0000-4000-8000-00000000000a', 'department',
   '00000000-0000-4000-8000-0000000a0001', 1, '{"code": "ACC", "name": "บัญชี"}', '00000000-0000-4000-8000-000000000103'),
  ('00000000-0000-4000-8000-0000000be001', '00000000-0000-4000-8000-00000000000b', 'department',
   '00000000-0000-4000-8000-0000000b0001', 1, '{"code": "ACC", "name": "บัญชี"}', '00000000-0000-4000-8000-000000000203')
on conflict (id) do nothing;
