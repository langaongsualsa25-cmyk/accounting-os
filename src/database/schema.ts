import { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantsTable {
  id: Generated<string>;
  tenant_id: Generated<string>;
  code: string;
  name: string;
  status: Generated<'active' | 'suspended'>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RolesTable {
  tenant_id: string;
  id: string;
  level: number;
  name: string;
}

export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  external_subject: string;
  display_name: string;
  email: string | null;
  role_id: string;
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

export interface UserDepartmentAccessTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  department_id: string;
  granted_at: Timestamp;
}

export interface AuditLogsTable {
  id: Generated<string>;
  tenant_id: string;
  seq: string;
  occurred_at: Timestamp;
  actor_user_id: string | null;
  actor_subject: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: unknown;
  after_data: unknown;
  reason: string | null;
  prev_hash: Buffer | null;
  hash: Buffer;
}

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ChangeRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  entity_type: string;
  entity_id: string | null;
  base_version: number | null;
  proposed: unknown;
  reason: string;
  status: ColumnType<ChangeRequestStatus, ChangeRequestStatus | undefined, ChangeRequestStatus>;
  // Set by the database from the caller's identity.
  requested_by: ColumnType<string, string | undefined, never>;
  requested_at: Timestamp;
  decided_by: ColumnType<string | null, never, never>;
  decided_at: ColumnType<Date | null, never, never>;
  decision_note: string | null;
}

export interface RecordVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  data: unknown;
  effective_from: Timestamp;
  effective_to: Date | null;
  change_request_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: Timestamp;
}

export interface Database {
  audit_logs: AuditLogsTable;
  change_requests: ChangeRequestsTable;
  record_versions: RecordVersionsTable;
  tenants: TenantsTable;
  roles: RolesTable;
  users: UsersTable;
  departments: DepartmentsTable;
  user_department_access: UserDepartmentAccessTable;
}
