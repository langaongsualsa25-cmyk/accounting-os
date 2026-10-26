import { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantsTable {
  id: Generated<string>;
  code: string;
  name: string;
  status: Generated<'active' | 'suspended'>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RolesTable {
  id: string;
  level: number;
  name: string;
}

export interface UsersTable {
  id: Generated<string>;
  external_subject: string;
  display_name: string;
  email: string | null;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DepartmentsTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserTenantAccessTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  role_id: string;
  granted_at: Timestamp;
}

export interface UserDepartmentAccessTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  department_id: string;
  granted_at: Timestamp;
}

export interface Database {
  tenants: TenantsTable;
  roles: RolesTable;
  users: UsersTable;
  departments: DepartmentsTable;
  user_tenant_access: UserTenantAccessTable;
  user_department_access: UserDepartmentAccessTable;
}
