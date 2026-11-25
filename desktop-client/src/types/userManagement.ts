export type AppModuleId =
  | 'practice'
  | 'concert'
  | 'setlists'
  | 'soundcheck'
  | 'studio'
  | 'mastering'
  | 'sample_lab'
  | 'editor'
  | 'lyrics'
  | 'design'
  | 'nacion_cms'
  | 'mobile_inear'
  | 'users_admin';

export type AppModuleCategory =
  | 'escenario'
  | 'estudio'
  | 'web_cms'
  | 'monitoreo'
  | 'administracion';

export interface AppModuleDefinition {
  id: AppModuleId;
  label: string;
  shortLabel: string;
  description: string;
  category: AppModuleCategory;
  primaryPath: string;
  matchPaths: string[];
  isCritical?: boolean;
}

export type UserRoleId =
  | 'super_admin'
  | 'studio_producer'
  | 'live_engineer'
  | 'stage_musician'
  | 'content_editor'
  | 'custom';

export type UserAccountStatus = 'active' | 'inactive' | 'suspended';

export interface UserRolePreset {
  id: UserRoleId;
  label: string;
  badgeColor: string;
  description: string;
  defaultModules: AppModuleId[];
}

export interface TanduUserProfile {
  id: string;
  email: string;
  full_name: string;
  title: string;
  role: UserRoleId;
  status: UserAccountStatus;
  allowed_modules: AppModuleId[];
  password_hash?: string;
  password_salt?: string;
  password_updated_at?: string;
  must_change_password: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
  deactivated_at?: string | null;
  deactivation_reason?: string | null;
  created_by?: string | null;
  is_system_owner?: boolean;
}

export interface CreateTanduUserInput {
  email: string;
  full_name: string;
  title?: string;
  password: string;
  role: UserRoleId;
  status?: UserAccountStatus;
  allowed_modules: AppModuleId[];
  must_change_password?: boolean;
  notes?: string;
  actorEmail?: string;
}

export interface UpdateTanduUserInput {
  full_name?: string;
  title?: string;
  role?: UserRoleId;
  status?: UserAccountStatus;
  allowed_modules?: AppModuleId[];
  must_change_password?: boolean;
  notes?: string;
  deactivation_reason?: string | null;
  actorEmail?: string;
}

export type UserAuditActionType =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'USER_SUSPENDED'
  | 'USER_DELETED'
  | 'PASSWORD_CHANGED'
  | 'MODULES_UPDATED';

export interface UserAuditLogEntry {
  id: string;
  action: UserAuditActionType;
  target_user_id: string;
  target_email: string;
  target_name: string;
  actor_email: string;
  summary: string;
  created_at: string;
}

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Muy Débil' | 'Débil' | 'Aceptable' | 'Fuerte' | 'Quirúrgica';
  color: string;
  suggestions: string[];
}
