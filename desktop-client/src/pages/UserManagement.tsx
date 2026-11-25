import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ShieldCheck,
  UserPlus,
  UserCheck,
  UserX,
  KeyRound,
  Search,
  RefreshCw,
  Database,
  Copy,
  Check,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
  Unlock,
  Clock,
  AlertTriangle,
  History,
  Save,
  X,
  CheckCircle2,
  SlidersHorizontal,
  PauseCircle,
  Shield,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type {
  AppModuleCategory,
  AppModuleId,
  TanduUserProfile,
  UserAccountStatus,
  UserAuditLogEntry,
  UserRoleId,
} from '../types/userManagement';
import {
  ALL_MODULE_IDS,
  APP_MODULES,
  APP_MODULE_CATEGORIES,
  USER_MANAGEMENT_SQL_MIGRATION,
  USER_ROLE_PRESETS,
  changeTanduUserPassword,
  createTanduUser,
  deleteTanduUser,
  evaluatePasswordStrength,
  generateStrongPassword,
  isSystemOwnerEmail,
  loadTanduUsersDirectory,
  setTanduUserStatus,
  subscribeToUsersUpdated,
  updateTanduUser,
} from '../services/userManagementService';

const SPRING_TRANSITION = { type: 'spring' as const, stiffness: 360, damping: 30 };

const MODULE_CATEGORY_ORDER: AppModuleCategory[] = [
  'escenario',
  'estudio',
  'web_cms',
  'monitoreo',
  'administracion',
];

const ROLE_ORDER: UserRoleId[] = [
  'super_admin',
  'studio_producer',
  'live_engineer',
  'stage_musician',
  'content_editor',
  'custom',
];

function formatDateShort(iso?: string | null): string {
  if (!iso) return 'Sin registro';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Sin registro';
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Sin registro';
  }
}

function getInitials(name: string, email: string): string {
  const clean = (name || '').trim();
  if (clean) {
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }
  return (email || 'TU').slice(0, 2).toUpperCase();
}

export default function UserManagement() {
  const { userProfile: activeAdminProfile, refreshUserProfile } = useAuth();

  const [users, setUsers] = useState<TanduUserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<UserAuditLogEntry[]>([]);
  const [missingSupabaseTable, setMissingSupabaseTable] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UserAccountStatus>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRoleId>('all');
  const [activeViewTab, setActiveViewTab] = useState<'directory' | 'audit'>('directory');

  // Selected user in Surgical Inspector
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState<{
    full_name: string;
    title: string;
    role: UserRoleId;
    status: UserAccountStatus;
    allowed_modules: AppModuleId[];
    must_change_password: boolean;
    notes: string;
  } | null>(null);
  const [savingInspector, setSavingInspector] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, kind === 'err' ? 7000 : 4000);
  }, []);

  // Modal 1: Create User (Dar de Alta)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{
    email: string;
    full_name: string;
    title: string;
    password: string;
    role: UserRoleId;
    status: UserAccountStatus;
    allowed_modules: AppModuleId[];
    must_change_password: boolean;
    notes: string;
  }>({
    email: '',
    full_name: '',
    title: 'Músico de Escenario',
    password: generateStrongPassword(12),
    role: 'stage_musician',
    status: 'active',
    allowed_modules: [...USER_ROLE_PRESETS.stage_musician.defaultModules],
    must_change_password: false,
    notes: '',
  });
  const [showCreatePwd, setShowCreatePwd] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);

  // Modal 2: Password Management
  const [passwordTargetUser, setPasswordTargetUser] = useState<TanduUserProfile | null>(null);
  const [pwdForm, setPwdForm] = useState({
    newPassword: '',
    confirmPassword: '',
    mustChangeOnNextLogin: false,
  });
  const [showResetPwd, setShowResetPwd] = useState(true);
  const [savingPassword, setSavingPassword] = useState(false);
  const [pwdModalFeedback, setPwdModalFeedback] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // Modal 3: Deactivate / Suspend (Dar de Baja)
  const [statusModalTarget, setStatusModalTarget] = useState<{
    user: TanduUserProfile;
    targetStatus: 'inactive' | 'suspended';
  } | null>(null);
  const [deactivationReason, setDeactivationReason] = useState('');
  const [savingStatusChange, setSavingStatusChange] = useState(false);

  // Modal 4: Delete User Confirmation
  const [deleteTargetUser, setDeleteTargetUser] = useState<TanduUserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Modal 5: SQL Supabase Schema
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadTanduUsersDirectory();
      setUsers(result.users);
      setAuditLogs(result.auditLogs);
      setMissingSupabaseTable(result.missingSupabaseTable);
      setSelectedUserId((prevId) => {
        if (prevId && result.users.some((u) => u.id === prevId)) return prevId;
        return result.users[0]?.id || null;
      });
    } catch (err: any) {
      notify('err', err?.message || 'Error al cargar el directorio de usuarios.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    return subscribeToUsersUpdated(() => {
      void loadTanduUsersDirectory().then((res) => {
        setUsers(res.users);
        setAuditLogs(res.auditLogs);
      });
    });
  }, []);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  // Sync Inspector Draft when selectedUser changes
  useEffect(() => {
    if (!selectedUser) {
      setInspectorDraft(null);
      return;
    }
    setInspectorDraft({
      full_name: selectedUser.full_name,
      title: selectedUser.title,
      role: selectedUser.role,
      status: selectedUser.status,
      allowed_modules: [...selectedUser.allowed_modules],
      must_change_password: selectedUser.must_change_password,
      notes: selectedUser.notes,
    });
  }, [selectedUser]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q) ||
        u.notes.toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, statusFilter, roleFilter]);

  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.status === 'active').length;
    const inactive = users.filter((u) => u.status === 'inactive').length;
    const suspended = users.filter((u) => u.status === 'suspended').length;
    const admins = users.filter(
      (u) => u.role === 'super_admin' || u.allowed_modules.includes('users_admin')
    ).length;
    return { total, active, inactive, suspended, admins };
  }, [users]);

  // ============================================================================
  // HANDLERS: INSPECTOR & MODULE MATRIX
  // ============================================================================
  const handleInspectorRoleSelect = (roleId: UserRoleId) => {
    if (!inspectorDraft || !selectedUser) return;
    if (selectedUser.is_system_owner || isSystemOwnerEmail(selectedUser.email)) return;
    const preset = USER_ROLE_PRESETS[roleId];
    setInspectorDraft({
      ...inspectorDraft,
      role: roleId,
      title:
        inspectorDraft.title === USER_ROLE_PRESETS[inspectorDraft.role].label
          ? preset.label
          : inspectorDraft.title,
      allowed_modules:
        roleId === 'custom' ? inspectorDraft.allowed_modules : [...preset.defaultModules],
    });
  };

  const handleInspectorToggleModule = (moduleId: AppModuleId) => {
    if (!inspectorDraft || !selectedUser) return;
    if (selectedUser.is_system_owner || isSystemOwnerEmail(selectedUser.email)) {
      notify('err', 'La cuenta maestra del Super Administrador mantiene todos los módulos activos.');
      return;
    }

    const exists = inspectorDraft.allowed_modules.includes(moduleId);
    const nextModules = exists
      ? inspectorDraft.allowed_modules.filter((m) => m !== moduleId)
      : [...inspectorDraft.allowed_modules, moduleId];

    if (nextModules.length === 0) {
      notify('err', 'El usuario debe tener al menos 1 módulo asignado (o dalo de baja si no tendrá acceso).');
      return;
    }

    // Check if nextModules matches current role preset; if not, switch role to 'custom' (unless super_admin)
    const presetModules = USER_ROLE_PRESETS[inspectorDraft.role].defaultModules;
    const matchesPreset =
      presetModules.length === nextModules.length &&
      presetModules.every((m) => nextModules.includes(m));

    setInspectorDraft({
      ...inspectorDraft,
      role: matchesPreset ? inspectorDraft.role : 'custom',
      allowed_modules: nextModules,
    });
  };

  const handleSaveInspector = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUser || !inspectorDraft) return;

    setSavingInspector(true);
    try {
      const updated = await updateTanduUser(selectedUser.id, {
        targetEmail: selectedUser.email,
        full_name: inspectorDraft.full_name,
        title: inspectorDraft.title,
        role: inspectorDraft.role,
        status: inspectorDraft.status,
        allowed_modules: inspectorDraft.allowed_modules,
        must_change_password: inspectorDraft.must_change_password,
        notes: inspectorDraft.notes,
        actorEmail: activeAdminProfile?.email,
      });
      void refreshUserProfile();
      notify(
        'ok',
        `Cambios aplicados para ${updated.full_name} (${updated.allowed_modules.length} módulos activos).`
      );
    } catch (err: any) {
      notify('err', err?.message || 'No se pudieron guardar los cambios del usuario.');
    } finally {
      setSavingInspector(false);
    }
  };

  // ============================================================================
  // HANDLERS: DAR DE ALTA (CREATE USER)
  // ============================================================================
  const openCreateUserModal = () => {
    const pwd = generateStrongPassword(12);
    setCreateForm({
      email: '',
      full_name: '',
      title: USER_ROLE_PRESETS.stage_musician.label,
      password: pwd,
      role: 'stage_musician',
      status: 'active',
      allowed_modules: [...USER_ROLE_PRESETS.stage_musician.defaultModules],
      must_change_password: false,
      notes: '',
    });
    setShowCreatePwd(true);
    setShowCreateModal(true);
  };

  const handleCreateRoleChange = (roleId: UserRoleId) => {
    const preset = USER_ROLE_PRESETS[roleId];
    setCreateForm((prev) => ({
      ...prev,
      role: roleId,
      title: preset.label,
      allowed_modules: roleId === 'custom' ? prev.allowed_modules : [...preset.defaultModules],
    }));
  };

  const handleCreateToggleModule = (moduleId: AppModuleId) => {
    setCreateForm((prev) => {
      const exists = prev.allowed_modules.includes(moduleId);
      const next = exists
        ? prev.allowed_modules.filter((m) => m !== moduleId)
        : [...prev.allowed_modules, moduleId];
      if (next.length === 0) return prev;
      return {
        ...prev,
        role: 'custom',
        allowed_modules: next,
      };
    });
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    try {
      const created = await createTanduUser({
        ...createForm,
        actorEmail: activeAdminProfile?.email,
      });
      setSelectedUserId(created.id);
      setShowCreateModal(false);
      notify('ok', `Usuario "${created.full_name}" (${created.email}) dado de alta exitosamente.`);
    } catch (err: any) {
      notify('err', err?.message || 'Error al dar de alta al usuario.');
    } finally {
      setCreatingUser(false);
    }
  };

  // ============================================================================
  // HANDLERS: DAR DE BAJA / REACTIVAR
  // ============================================================================
  const handleQuickReactivate = async (user: TanduUserProfile) => {
    try {
      const updated = await setTanduUserStatus({
        userId: user.id,
        targetEmail: user.email,
        status: 'active',
        actorEmail: activeAdminProfile?.email,
      });
      notify('ok', `Usuario "${updated.full_name}" reactivado (En Alta).`);
    } catch (err: any) {
      notify('err', err?.message || 'Error al reactivar usuario.');
    }
  };

  const handleConfirmDeactivateOrSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalTarget) return;
    setSavingStatusChange(true);
    try {
      const updated = await setTanduUserStatus({
        userId: statusModalTarget.user.id,
        targetEmail: statusModalTarget.user.email,
        status: statusModalTarget.targetStatus,
        reason: deactivationReason.trim() || undefined,
        actorEmail: activeAdminProfile?.email,
      });
      setStatusModalTarget(null);
      setDeactivationReason('');
      notify(
        'ok',
        updated.status === 'inactive'
          ? `Usuario "${updated.full_name}" dado de baja correctamente.`
          : `Usuario "${updated.full_name}" suspendido temporalmente.`
      );
    } catch (err: any) {
      notify('err', err?.message || 'Error al cambiar el estado del usuario.');
    } finally {
      setSavingStatusChange(false);
    }
  };

  // ============================================================================
  // HANDLERS: PASSWORD MANAGEMENT & CREDENTIALS COPY
  // ============================================================================
  const openPasswordModalForUser = (user: TanduUserProfile) => {
    const suggested = generateStrongPassword(12);
    setPasswordTargetUser(user);
    setPwdForm({
      newPassword: suggested,
      confirmPassword: suggested,
      mustChangeOnNextLogin: false,
    });
    setShowResetPwd(true);
    setPwdModalFeedback(null);
    setCopiedCredentials(false);
  };

  const handleSaveUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTargetUser || savingPassword) return;
    setPwdModalFeedback(null);

    if (!pwdForm.newPassword || pwdForm.newPassword.length < 6) {
      const msg = 'La contraseña debe tener al menos 6 caracteres.';
      setPwdModalFeedback({ kind: 'err', text: msg });
      notify('err', msg);
      return;
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      const msg = 'Las contraseñas ingresadas no coinciden.';
      setPwdModalFeedback({ kind: 'err', text: msg });
      notify('err', msg);
      return;
    }

    setSavingPassword(true);
    try {
      const updated = await changeTanduUserPassword({
        userId: passwordTargetUser.id,
        targetEmail: passwordTargetUser.email,
        newPassword: pwdForm.newPassword,
        mustChangeOnNextLogin: pwdForm.mustChangeOnNextLogin,
        actorEmail: activeAdminProfile?.email,
      });
      setUsers((prev) =>
        prev.map((u) => (u.email === updated.email || u.id === updated.id ? updated : u))
      );
      void refreshUserProfile();
      const okMsg = `Contraseña actualizada correctamente para "${updated.full_name}".`;
      setPwdModalFeedback({ kind: 'ok', text: okMsg });
      notify('ok', okMsg);
      window.setTimeout(() => {
        setPasswordTargetUser(null);
        setPwdModalFeedback(null);
      }, 650);
    } catch (err: any) {
      const errMsg = err?.message || 'Error al actualizar la contraseña.';
      setPwdModalFeedback({ kind: 'err', text: errMsg });
      notify('err', errMsg);
    } finally {
      setSavingPassword(false);
    }
  };

  const copyCredentialsSummary = async (user: TanduUserProfile, plainPassword?: string) => {
    const moduleNames = APP_MODULES.filter((m) => user.allowed_modules.includes(m.id))
      .map((m) => m.label)
      .join(', ');
    const text = [
      `=== CREDENCIALES TANDU MUSICOS / STAGE ===`,
      `Nombre: ${user.full_name}`,
      `Correo: ${user.email}`,
      plainPassword ? `Contraseña: ${plainPassword}` : `Estado: ${user.status.toUpperCase()}`,
      `Rol: ${USER_ROLE_PRESETS[user.role].label}`,
      `Módulos Habilitados (${user.allowed_modules.length}): ${moduleNames}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedCredentials(true);
      notify('ok', `Ficha de credenciales de ${user.full_name} copiada al portapapeles.`);
      setTimeout(() => setCopiedCredentials(false), 2500);
    } catch {
      notify('err', 'No se pudo copiar al portapapeles.');
    }
  };

  // ============================================================================
  // HANDLER: DELETE USER
  // ============================================================================
  const handleConfirmDeleteUser = async () => {
    if (!deleteTargetUser) return;
    setDeletingUser(true);
    try {
      const deletedName = deleteTargetUser.full_name;
      await deleteTanduUser({
        userId: deleteTargetUser.id,
        targetEmail: deleteTargetUser.email,
        actorEmail: activeAdminProfile?.email,
      });
      setDeleteTargetUser(null);
      notify('ok', `Usuario "${deletedName}" eliminado definitivamente.`);
    } catch (err: any) {
      notify('err', err?.message || 'Error al eliminar el usuario.');
    } finally {
      setDeletingUser(false);
    }
  };

  const createPwdStrength = evaluatePasswordStrength(createForm.password);
  const resetPwdStrength = evaluatePasswordStrength(pwdForm.newPassword);

  const renderStatusBadge = (status: UserAccountStatus) => {
    if (status === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          En Alta
        </span>
      );
    }
    if (status === 'suspended') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Suspendido
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-rose-400">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        De Baja
      </span>
    );
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0b0d13] text-zinc-100 select-none">
      {/* Floating Notification Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={SPRING_TRANSITION}
            className={`fixed right-6 top-5 z-[100] flex items-center gap-3 rounded-xl border px-4 py-3 text-xs font-medium shadow-2xl ${
              toast.kind === 'ok'
                ? 'border-emerald-500/40 bg-[#0f1f1a] text-emerald-300'
                : 'border-rose-500/40 bg-[#221117] text-rose-300'
            }`}
          >
            {toast.kind === 'ok' ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="text-rose-400 shrink-0" />
            )}
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 text-zinc-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Studio Header Bar */}
      <header className="shrink-0 border-b border-zinc-800/80 bg-[#0e1118] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-emerald-400">
                  SEGURIDAD & ACCESOS · TANDU STAGE
                </span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-[9.5px] font-mono text-zinc-300">
                  {missingSupabaseTable ? 'SYNC HÍBRIDO LOCAL' : 'SUPABASE CLOUD SYNC'}
                </span>
              </div>
              <h1 className="text-lg font-bold tracking-tight text-white">
                Administración de Usuarios, Contraseñas y Permisos de Módulos
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Switch View: Directory vs Audit Logs */}
            <div className="flex items-center rounded-xl border border-zinc-800 bg-[#0b0d13] p-1">
              <button
                type="button"
                onClick={() => setActiveViewTab('directory')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeViewTab === 'directory'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <SlidersHorizontal size={13} />
                <span>Usuarios & Módulos</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('audit')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  activeViewTab === 'audit'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <History size={13} />
                <span>Bitácora ({auditLogs.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSqlModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-[#141822] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer"
              title="Ver esquema SQL para Supabase"
            >
              <Database size={14} className="text-emerald-400" />
              <span>SQL Supabase</span>
            </button>

            <button
              type="button"
              onClick={() => void loadDirectory()}
              className="flex items-center justify-center rounded-xl border border-zinc-800 bg-[#141822] p-2 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer"
              title="Sincronizar directorio"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin text-emerald-400' : ''} />
            </button>

            <button
              type="button"
              onClick={openCreateUserModal}
              className="flex items-center gap-2 rounded-xl bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-950/40 transition-colors hover:bg-[#be123c] cursor-pointer"
            >
              <UserPlus size={15} />
              <span>Dar de Alta Usuario</span>
            </button>
          </div>
        </div>

        {/* KPI Metrics Strip */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-[#11151f] px-4 py-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Total Registrados
              </span>
              <div className="text-lg font-bold text-white">{metrics.total}</div>
            </div>
            <Shield size={18} className="text-zinc-500" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400/90">
                Usuarios en Alta (Activos)
              </span>
              <div className="text-lg font-bold text-emerald-400">{metrics.active}</div>
            </div>
            <UserCheck size={18} className="text-emerald-400" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400/90">
                De Baja / Suspendidos
              </span>
              <div className="text-lg font-bold text-rose-400">
                {metrics.inactive + metrics.suspended}
              </div>
            </div>
            <UserX size={18} className="text-rose-400" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-blue-500/20 bg-blue-500/[0.04] px-4 py-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400/90">
                Módulos Controlados
              </span>
              <div className="text-lg font-bold text-blue-400">
                {APP_MODULES.length} <span className="text-xs font-normal text-zinc-400">módulos</span>
              </div>
            </div>
            <Lock size={18} className="text-blue-400" />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      {activeViewTab === 'audit' ? (
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <div className="mx-auto max-w-5xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
                  Bitácora de Auditoría de Usuarios y Permisos
                </h2>
                <p className="text-xs text-zinc-400">
                  Registro cronológico de altas, bajas, cambios de contraseña y modificaciones de acceso a módulos.
                </p>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/80 rounded-2xl border border-zinc-800 bg-[#0e1118]">
              {auditLogs.length === 0 ? (
                <div className="p-12 text-center text-xs text-zinc-500">
                  Aún no hay movimientos registrados en la bitácora.
                </div>
              ) : (
                auditLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 text-xs"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 inline-flex rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          entry.action === 'USER_CREATED' || entry.action === 'USER_ACTIVATED'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : entry.action === 'USER_DEACTIVATED' ||
                                entry.action === 'USER_DELETED' ||
                                entry.action === 'USER_SUSPENDED'
                              ? 'bg-rose-500/15 text-rose-400'
                              : entry.action === 'PASSWORD_CHANGED'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-blue-500/15 text-blue-400'
                        }`}
                      >
                        {entry.action}
                      </span>
                      <div>
                        <div className="font-medium text-zinc-100">
                          {entry.target_name}{' '}
                          <span className="font-mono text-zinc-400">({entry.target_email})</span>
                        </div>
                        <div className="mt-0.5 text-zinc-400">{entry.summary}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px] text-zinc-500">
                      <div>{formatDateShort(entry.created_at)}</div>
                      <div>Por: {entry.actor_email}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* LEFT COLUMN (5 cols): User Directory List */}
          <div className="flex flex-col overflow-hidden border-r border-zinc-800/80 bg-[#0c0f16] lg:col-span-5">
            {/* Search & Filters Bar */}
            <div className="shrink-0 space-y-3 border-b border-zinc-800/80 p-4">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre, correo, cargo o nota..."
                  className="w-full rounded-xl border border-zinc-800 bg-[#121621] py-2.5 pl-10 pr-4 text-xs text-white placeholder-zinc-500 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'all', label: 'Todos' },
                      { id: 'active', label: 'En Alta' },
                      { id: 'inactive', label: 'De Baja' },
                      { id: 'suspended', label: 'Suspendidos' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStatusFilter(tab.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                        statusFilter === tab.id
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRoleId)}
                  className="rounded-lg border border-zinc-800 bg-[#121621] px-2.5 py-1 text-[11px] text-zinc-300 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">Todos los Roles</option>
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_PRESETS[r].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Scrollable User Directory */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4 custom-scrollbar">
              {filteredUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
                  <p className="text-xs text-zinc-400">
                    No se encontraron usuarios con los filtros actuales.
                  </p>
                </div>
              ) : (
                filteredUsers.map((u) => {
                  const isSelected = u.id === selectedUserId;
                  const rolePreset = USER_ROLE_PRESETS[u.role];
                  const isOwner = Boolean(u.is_system_owner || isSystemOwnerEmail(u.email));

                  return (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`group relative rounded-2xl border p-4 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500/60 bg-[#141926] shadow-lg'
                          : 'border-zinc-800/80 bg-[#10131c] hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 overflow-hidden">
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-xs font-bold text-white"
                            style={{
                              backgroundColor: `${rolePreset.badgeColor}22`,
                              borderColor: `${rolePreset.badgeColor}55`,
                            }}
                          >
                            {getInitials(u.full_name, u.email)}
                          </div>
                          <div className="overflow-hidden">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-bold text-white">
                                {u.full_name}
                              </span>
                              {isOwner && (
                                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-300">
                                  CUENTA MAESTRA
                                </span>
                              )}
                            </div>
                            <div className="truncate font-mono text-xs text-zinc-400">
                              {u.email}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                                style={{
                                  backgroundColor: `${rolePreset.badgeColor}18`,
                                  color: rolePreset.badgeColor,
                                }}
                              >
                                {rolePreset.label}
                              </span>
                              <span className="text-[11px] text-zinc-400">· {u.title}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {renderStatusBadge(u.status)}
                          <span className="font-mono text-[10px] text-zinc-400">
                            {u.allowed_modules.length} / {APP_MODULES.length} módulos
                          </span>
                        </div>
                      </div>

                      {/* Deactivation reason banner if inactive/suspended */}
                      {u.status !== 'active' && u.deactivation_reason && (
                        <div className="mt-2.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-300">
                          Motivo: {u.deactivation_reason}
                        </div>
                      )}

                      {/* Quick Action Row */}
                      <div
                        className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 pt-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                          <Clock size={11} />
                          <span>Último acceso: {formatDateShort(u.last_login_at)}</span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openPasswordModalForUser(u)}
                            className="flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-800/70 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 cursor-pointer"
                            title="Cambiar o restablecer contraseña"
                          >
                            <KeyRound size={12} />
                            <span>Contraseña</span>
                          </button>

                          {!isOwner && (
                            <>
                              {u.status === 'active' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeactivationReason('');
                                    setStatusModalTarget({ user: u, targetStatus: 'inactive' });
                                  }}
                                  className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/20 cursor-pointer"
                                  title="Dar de baja al usuario"
                                >
                                  <UserX size={12} />
                                  <span>Dar de Baja</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleQuickReactivate(u)}
                                  className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
                                  title="Reactivar (Dar de Alta nuevamente)"
                                >
                                  <UserCheck size={12} />
                                  <span>Dar de Alta</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setDeleteTargetUser(u)}
                                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-rose-500/40 hover:text-rose-400 cursor-pointer"
                                title="Eliminar usuario permanentemente"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT COLUMN (7 cols): Surgical User & Module Permissions Inspector */}
          <div className="flex flex-col overflow-y-auto bg-[#0b0d13] p-6 custom-scrollbar lg:col-span-7">
            {!selectedUser || !inspectorDraft ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Selecciona un usuario del directorio para administrar su perfil, contraseña y acceso a módulos.
              </div>
            ) : (
              <form onSubmit={handleSaveInspector} className="space-y-6 pb-16">
                {/* Inspector Header Card */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-[#10131c] p-5">
                  <div className="flex items-center gap-3.5">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-2xl border text-sm font-bold text-white"
                      style={{
                        backgroundColor: `${USER_ROLE_PRESETS[inspectorDraft.role].badgeColor}22`,
                        borderColor: `${USER_ROLE_PRESETS[inspectorDraft.role].badgeColor}66`,
                      }}
                    >
                      {getInitials(inspectorDraft.full_name, selectedUser.email)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-base font-bold text-white">
                          {inspectorDraft.full_name}
                        </h2>
                        {renderStatusBadge(inspectorDraft.status)}
                      </div>
                      <p className="font-mono text-xs text-zinc-400">{selectedUser.email}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openPasswordModalForUser(selectedUser)}
                      className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 cursor-pointer"
                    >
                      <KeyRound size={14} />
                      <span>Manejo de Contraseña</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void copyCredentialsSummary(selectedUser)}
                      className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer"
                    >
                      <Copy size={13} />
                      <span>Copiar Ficha</span>
                    </button>

                    <button
                      type="submit"
                      disabled={savingInspector}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                    >
                      <Save size={14} />
                      <span>{savingInspector ? 'Guardando...' : 'Guardar Cambios'}</span>
                    </button>
                  </div>
                </div>

                {/* Section 1: Identity & Operational Status (Alta / Baja / Suspensión) */}
                <div className="rounded-2xl border border-zinc-800 bg-[#10131c] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                      1. Datos del Usuario y Estado Operativo (Alta / Baja)
                    </h3>
                    {selectedUser.is_system_owner && (
                      <span className="text-[11px] font-mono text-amber-400">
                        Cuenta Maestra Protegida
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                        Nombre Completo
                      </label>
                      <input
                        type="text"
                        value={inspectorDraft.full_name}
                        onChange={(e) =>
                          setInspectorDraft({ ...inspectorDraft, full_name: e.target.value })
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                        Cargo / Instrumento / Especialidad
                      </label>
                      <input
                        type="text"
                        value={inspectorDraft.title}
                        onChange={(e) =>
                          setInspectorDraft({ ...inspectorDraft, title: e.target.value })
                        }
                        placeholder="Ej: Ingeniero FOH, Baterista, Productor..."
                        className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Operational Status Switcher */}
                  <div>
                    <label className="mb-2 block text-xs font-medium text-zinc-400">
                      Estado de la Cuenta en el Sistema
                    </label>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() =>
                          setInspectorDraft({ ...inspectorDraft, status: 'active' })
                        }
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                          inspectorDraft.status === 'active'
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                            : 'border-zinc-800 bg-[#0b0d13] text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <UserCheck size={16} className="text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold">En Alta (Activo)</div>
                          <div className="text-[10px] text-zinc-400">Acceso permitido</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={Boolean(selectedUser.is_system_owner)}
                        onClick={() =>
                          setInspectorDraft({ ...inspectorDraft, status: 'suspended' })
                        }
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          inspectorDraft.status === 'suspended'
                            ? 'border-amber-500/60 bg-amber-500/10 text-white'
                            : 'border-zinc-800 bg-[#0b0d13] text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <PauseCircle size={16} className="text-amber-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold">Suspendido</div>
                          <div className="text-[10px] text-zinc-400">Pausa temporal</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={Boolean(selectedUser.is_system_owner)}
                        onClick={() =>
                          setInspectorDraft({ ...inspectorDraft, status: 'inactive' })
                        }
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          inspectorDraft.status === 'inactive'
                            ? 'border-rose-500/60 bg-rose-500/10 text-white'
                            : 'border-zinc-800 bg-[#0b0d13] text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <UserX size={16} className="text-rose-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold">De Baja (Inactivo)</div>
                          <div className="text-[10px] text-zinc-400">Acceso revocado</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                      Notas Administrativas / Observaciones
                    </label>
                    <input
                      type="text"
                      value={inspectorDraft.notes}
                      onChange={(e) =>
                        setInspectorDraft({ ...inspectorDraft, notes: e.target.value })
                      }
                      placeholder="Notas sobre permisos, turno o responsabilidades..."
                      className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Section 2: Role Preset Templates */}
                <div className="rounded-2xl border border-zinc-800 bg-[#10131c] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                        2. Plantilla de Rol Operativo
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Selecciona un perfil para preconfigurar sus módulos recomendados o personalízalos abajo.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {ROLE_ORDER.map((roleId) => {
                      const preset = USER_ROLE_PRESETS[roleId];
                      const isSelectedRole = inspectorDraft.role === roleId;
                      return (
                        <button
                          key={roleId}
                          type="button"
                          disabled={Boolean(selectedUser.is_system_owner && roleId !== 'super_admin')}
                          onClick={() => handleInspectorRoleSelect(roleId)}
                          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            isSelectedRole
                              ? 'border-white/40 bg-[#171c2b]'
                              : 'border-zinc-800 bg-[#0b0d13] hover:border-zinc-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-bold"
                                style={{ color: preset.badgeColor }}
                              >
                                {preset.label}
                              </span>
                              {isSelectedRole && (
                                <Check size={14} className="text-emerald-400 shrink-0" />
                              )}
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                              {preset.description}
                            </p>
                          </div>
                          <div className="mt-2.5 font-mono text-[10px] text-zinc-500">
                            {roleId === 'custom'
                              ? 'Selección libre'
                              : `${preset.defaultModules.length} módulos incluidos`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section 3: Granular Module Access Matrix */}
                <div className="rounded-2xl border border-zinc-800 bg-[#10131c] p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                        3. Matriz Quirúrgica de Acceso a Módulos ({inspectorDraft.allowed_modules.length} de{' '}
                        {APP_MODULES.length} habilitados)
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Activa o desactiva exactamente a qué módulos tiene acceso este usuario en la barra lateral y rutas.
                      </p>
                    </div>

                    {!selectedUser.is_system_owner && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setInspectorDraft({
                              ...inspectorDraft,
                              allowed_modules: [...ALL_MODULE_IDS],
                            })
                          }
                          className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-zinc-700 hover:text-white cursor-pointer"
                        >
                          Habilitar Todos
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setInspectorDraft({
                              ...inspectorDraft,
                              allowed_modules: [
                                ...USER_ROLE_PRESETS[inspectorDraft.role].defaultModules,
                              ],
                            })
                          }
                          className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-zinc-700 hover:text-white cursor-pointer"
                        >
                          Restablecer según Rol
                        </button>
                      </div>
                    )}
                  </div>

                  {MODULE_CATEGORY_ORDER.map((catKey) => {
                    const catInfo = APP_MODULE_CATEGORIES[catKey];
                    const catModules = APP_MODULES.filter((m) => m.category === catKey);

                    return (
                      <div key={catKey} className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: catInfo.accentColor }}
                            />
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                              {catInfo.label}
                            </span>
                          </div>
                          <span className="text-[11px] text-zinc-500">{catInfo.description}</span>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {catModules.map((mod) => {
                            const isAllowed = inspectorDraft.allowed_modules.includes(mod.id);
                            return (
                              <button
                                key={mod.id}
                                type="button"
                                onClick={() => handleInspectorToggleModule(mod.id)}
                                className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                                  isAllowed
                                    ? 'border-emerald-500/45 bg-emerald-500/[0.06] text-white'
                                    : 'border-zinc-800/80 bg-[#0b0d13] text-zinc-400 hover:border-zinc-700'
                                }`}
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-zinc-100">
                                      {mod.label}
                                    </span>
                                    <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-400">
                                      {mod.primaryPath}
                                    </span>
                                  </div>
                                  <p className="text-[11px] leading-snug text-zinc-400">
                                    {mod.description}
                                  </p>
                                </div>

                                <div
                                  className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                                    isAllowed ? 'bg-emerald-500 justify-end' : 'bg-zinc-800 justify-start'
                                  }`}
                                >
                                  <span className="h-5 w-5 rounded-full bg-white shadow" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-end border-t border-zinc-800 pt-4">
                    <button
                      type="submit"
                      disabled={savingInspector}
                      className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                    >
                      <Save size={15} />
                      <span>
                        {savingInspector
                          ? 'Guardando Configuración...'
                          : 'Guardar Perfil y Permisos de Módulos'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: DAR DE ALTA NUEVO USUARIO (CREATE USER)
         ===================================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#10131c] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
                  <UserPlus size={19} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Dar de Alta Nuevo Usuario</h3>
                  <p className="text-xs text-zinc-400">
                    Configura sus credenciales de ingreso y los módulos a los que tendrá acceso.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={handleCreateUserSubmit}
              className="flex-1 space-y-5 overflow-y-auto p-6 custom-scrollbar"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                    Nombre Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.full_name}
                    onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                    placeholder="Ej: Carlos Mendoza"
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                    Correo Electrónico (Login) *
                  </label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    placeholder="carlos@tandu.com"
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                    Plantilla de Rol
                  </label>
                  <select
                    value={createForm.role}
                    onChange={(e) => handleCreateRoleChange(e.target.value as UserRoleId)}
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {USER_ROLE_PRESETS[r].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                    Cargo / Instrumento
                  </label>
                  <input
                    type="text"
                    value={createForm.title}
                    onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                    placeholder="Ej: Baterista, Productor, Ingeniero FOH..."
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Password Assignment Block */}
              <div className="rounded-xl border border-zinc-800 bg-[#0b0d13] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">
                    Contraseña de Acceso Inicial *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setCreateForm({ ...createForm, password: generateStrongPassword(12) })
                    }
                    className="flex items-center gap-1 text-xs font-medium text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    <Sparkles size={13} />
                    <span>Generar Contraseña Segura</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showCreatePwd ? 'text' : 'password'}
                    required
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-[#121621] px-3.5 py-2.5 pr-10 font-mono text-xs text-white focus:border-rose-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    {showCreatePwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex flex-1 items-center gap-1 pr-4">
                    {[1, 2, 3, 4].map((lvl) => (
                      <div
                        key={lvl}
                        className="h-1.5 flex-1 rounded-full"
                        style={{
                          backgroundColor:
                            createPwdStrength.score >= lvl ? createPwdStrength.color : '#27272a',
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: createPwdStrength.color }}
                  >
                    Seguridad: {createPwdStrength.label}
                  </span>
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.must_change_password}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, must_change_password: e.target.checked })
                    }
                    className="rounded border-zinc-700 bg-zinc-900 text-rose-500"
                  />
                  <span>
                    Solicitar que el usuario cambie su contraseña al iniciar sesión por primera vez
                  </span>
                </label>
              </div>

              {/* Modules Selection */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">
                    Accesos a Módulos Habilitados ({createForm.allowed_modules.length} de{' '}
                    {APP_MODULES.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCreateForm({ ...createForm, allowed_modules: [...ALL_MODULE_IDS] })
                      }
                      className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                    >
                      Marcar todos
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {APP_MODULES.map((mod) => {
                    const checked = createForm.allowed_modules.includes(mod.id);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => handleCreateToggleModule(mod.id)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-colors cursor-pointer ${
                          checked
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                            : 'border-zinc-800 bg-[#0b0d13] text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <div>
                          <div className="font-semibold">{mod.label}</div>
                          <div className="font-mono text-[10px] text-zinc-500">
                            {mod.primaryPath}
                          </div>
                        </div>
                        {checked ? (
                          <Unlock size={14} className="text-emerald-400 shrink-0" />
                        ) : (
                          <Lock size={14} className="text-zinc-600 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="flex items-center gap-2 rounded-xl bg-[#e11d48] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#be123c] disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus size={14} />
                  <span>{creatingUser ? 'Dando de Alta...' : 'Confirmar Alta de Usuario'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: MANEJO DE CONTRASEÑAS (ADMIN PASSWORD RESET & CREDENTIALS)
         ===================================================================== */}
      {passwordTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#10131c] p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                  <KeyRound size={19} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Manejo de Contraseña</h3>
                  <p className="text-xs text-zinc-400">
                    {passwordTargetUser.full_name} ({passwordTargetUser.email})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasswordTargetUser(null)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveUserPassword} className="mt-4 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Nueva Contraseña</label>
                  <button
                    type="button"
                    onClick={() => {
                      const gen = generateStrongPassword(12);
                      setPwdForm({ ...pwdForm, newPassword: gen, confirmPassword: gen });
                      setShowResetPwd(true);
                    }}
                    className="flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    <Sparkles size={12} />
                    <span>Generar Automática</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showResetPwd ? 'text' : 'password'}
                    required
                    value={pwdForm.newPassword}
                    onChange={(e) => {
                      setPwdForm({ ...pwdForm, newPassword: e.target.value });
                      if (pwdModalFeedback) setPwdModalFeedback(null);
                    }}
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 pr-10 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    {showResetPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <div className="flex flex-1 items-center gap-1 pr-3">
                    {[1, 2, 3, 4].map((lvl) => (
                      <div
                        key={lvl}
                        className="h-1.5 flex-1 rounded-full"
                        style={{
                          backgroundColor:
                            resetPwdStrength.score >= lvl ? resetPwdStrength.color : '#27272a',
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: resetPwdStrength.color }}
                  >
                    {resetPwdStrength.label}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Confirmar Contraseña
                </label>
                <input
                  type={showResetPwd ? 'text' : 'password'}
                  required
                  value={pwdForm.confirmPassword}
                  onChange={(e) => {
                    setPwdForm({ ...pwdForm, confirmPassword: e.target.value });
                    if (pwdModalFeedback) setPwdModalFeedback(null);
                  }}
                  className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              </div>

              {pwdModalFeedback && (
                <div
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                    pwdModalFeedback.kind === 'ok'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  }`}
                >
                  {pwdModalFeedback.kind === 'ok' ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle size={15} className="shrink-0 text-rose-400" />
                  )}
                  <span>{pwdModalFeedback.text}</span>
                </div>
              )}

              {!passwordTargetUser.is_system_owner && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pwdForm.mustChangeOnNextLogin}
                    onChange={(e) =>
                      setPwdForm({ ...pwdForm, mustChangeOnNextLogin: e.target.checked })
                    }
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  <span>Requerir cambio de contraseña cuando el usuario inicie sesión</span>
                </label>
              )}

              <button
                type="button"
                onClick={() => void copyCredentialsSummary(passwordTargetUser, pwdForm.newPassword)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 cursor-pointer"
              >
                {copiedCredentials ? (
                  <>
                    <Check size={14} className="text-emerald-400" />
                    <span className="text-emerald-400">Credenciales Copiadas al Portapapeles</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copiar Credenciales con esta Contraseña</span>
                  </>
                )}
              </button>

              <div className="flex items-center justify-end gap-2.5 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setPasswordTargetUser(null)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                >
                  <KeyRound size={14} />
                  <span>{savingPassword ? 'Actualizando...' : 'Actualizar Contraseña'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: DAR DE BAJA / SUSPENDER USUARIO
         ===================================================================== */}
      {statusModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#10131c] p-6 text-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
                <UserX size={19} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Dar de Baja / Suspender Usuario</h3>
                <p className="text-xs text-zinc-400">
                  {statusModalTarget.user.full_name} ({statusModalTarget.user.email})
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmDeactivateOrSuspend} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setStatusModalTarget({ ...statusModalTarget, targetStatus: 'inactive' })
                  }
                  className={`rounded-xl border p-3 text-left text-xs transition-colors cursor-pointer ${
                    statusModalTarget.targetStatus === 'inactive'
                      ? 'border-rose-500 bg-rose-500/15 text-white'
                      : 'border-zinc-800 bg-[#0b0d13] text-zinc-400'
                  }`}
                >
                  <div className="font-bold text-rose-400">Dar de Baja (Inactivo)</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    Revoca el acceso hasta nueva alta.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setStatusModalTarget({ ...statusModalTarget, targetStatus: 'suspended' })
                  }
                  className={`rounded-xl border p-3 text-left text-xs transition-colors cursor-pointer ${
                    statusModalTarget.targetStatus === 'suspended'
                      ? 'border-amber-500 bg-amber-500/15 text-white'
                      : 'border-zinc-800 bg-[#0b0d13] text-zinc-400'
                  }`}
                >
                  <div className="font-bold text-amber-400">Suspensión Temporal</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    Bloquea el inicio de sesión temporalmente.
                  </div>
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Motivo de la Baja / Suspensión (Opcional)
                </label>
                <input
                  type="text"
                  value={deactivationReason}
                  onChange={(e) => setDeactivationReason(e.target.value)}
                  placeholder="Ej: Fin de temporada, rotación de músico, baja administrativa..."
                  className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-xs text-white focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setStatusModalTarget(null)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingStatusChange}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 cursor-pointer"
                >
                  <UserX size={14} />
                  <span>
                    {savingStatusChange
                      ? 'Procesando...'
                      : statusModalTarget.targetStatus === 'inactive'
                        ? 'Confirmar Baja'
                        : 'Confirmar Suspensión'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: ELIMINACIÓN DEFINITIVA DE USUARIO
         ===================================================================== */}
      {deleteTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#10131c] p-6 text-white shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
                <Trash2 size={19} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Eliminar Usuario Permanentemente</h3>
                <p className="text-xs text-zinc-400">{deleteTargetUser.email}</p>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-zinc-300">
              ¿Estás seguro de eliminar definitivamente a{' '}
              <span className="font-bold text-white">{deleteTargetUser.full_name}</span>? Si solo
              deseas revocar su acceso conservando su historial, puedes usar la opción{' '}
              <span className="font-semibold text-rose-400">Dar de Baja</span>.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTargetUser(null)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingUser}
                onClick={() => void handleConfirmDeleteUser()}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 size={14} />
                <span>{deletingUser ? 'Eliminando...' : 'Eliminar Definitivamente'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: SQL SUPABASE MIGRATION
         ===================================================================== */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#10131c] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
              <div className="flex items-center gap-3">
                <Database size={18} className="text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Esquema SQL Supabase · Usuarios, Contraseñas y Permisos de Módulos
                  </h3>
                  <p className="text-xs text-zinc-400">
                    El módulo funciona inmediatamente con sincronización híbrida. Ejecuta este SQL en Supabase para persistencia en la nube multi-dispositivo.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#080a0f] p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
                {USER_MANAGEMENT_SQL_MIGRATION}
              </pre>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">
              <span className="text-xs text-zinc-400">
                Archivo también disponible en: docs/supabase/user_management_schema.sql
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(USER_MANAGEMENT_SQL_MIGRATION);
                    setSqlCopied(true);
                    setTimeout(() => setSqlCopied(false), 2500);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  {sqlCopied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{sqlCopied ? 'SQL Copiado' : 'Copiar Script SQL'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
