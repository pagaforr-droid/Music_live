import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
      }),
      upsert: () => ({
        select: async () => ({ data: [], error: null }),
      }),
      insert: async () => ({ data: null, error: null }),
      update: () => ({
        eq: () => ({
          select: async () => ({ data: [], error: null }),
        }),
      }),
      delete: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => ({ data: null, error: null }),
    },
  },
}));

import {
  ALL_MODULE_IDS,
  USER_ROLE_PRESETS,
  canUserAccessModule,
  changeTanduUserPassword,
  clearMemoryUsersStore,
  createTanduUser,
  deleteTanduUser,
  evaluatePasswordStrength,
  generateStrongPassword,
  getFirstAllowedPathForUser,
  readLocalAuditLogs,
  readLocalUsersRegistry,
  resolveModuleByPathname,
  setTanduUserStatus,
  updateTanduUser,
  verifyUserPassword,
} from '../userManagementService';

describe('User Management & Granular Module Access Control', () => {
  beforeEach(() => {
    clearMemoryUsersStore();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it('always seeds and protects the system owner (admin@tandu.com) with full module access', async () => {
    const users = readLocalUsersRegistry();
    const owner = users.find((u) => u.email === 'admin@tandu.com');
    expect(owner).toBeDefined();
    expect(owner?.role).toBe('super_admin');
    expect(owner?.status).toBe('active');
    expect(owner?.allowed_modules.length).toBe(ALL_MODULE_IDS.length);

    for (const modId of ALL_MODULE_IDS) {
      expect(canUserAccessModule(owner, modId)).toBe(true);
    }

    // Administrator automatically lands on Stem Studio (/studio) after app finishes loading
    expect(getFirstAllowedPathForUser(owner)).toBe('/studio');

    await expect(
      setTanduUserStatus({
        userId: owner!.id,
        status: 'inactive',
      })
    ).rejects.toThrow(/no puede darse de baja/i);

    await expect(
      deleteTanduUser({
        userId: owner!.id,
      })
    ).rejects.toThrow(/No se puede eliminar la cuenta maestra/i);

    // Changing owner password works even if UI passes a stale UUID when targetEmail matches
    const updatedOwner = await changeTanduUserPassword({
      userId: 'stale-or-remote-uuid-different-from-local',
      targetEmail: 'admin@tandu.com',
      newPassword: '123456',
    });
    expect(verifyUserPassword('123456', updatedOwner)).toBe(true);
    expect(updatedOwner.must_change_password).toBe(false);
  });

  it('registers a new user (Dar de Alta) with role preset, verifies password hash and module permissions', async () => {
    const newUser = await createTanduUser({
      email: 'baterista@tandu.com',
      full_name: 'Lucas Batería',
      title: 'Baterista En Vivo',
      password: 'StagePassword#2026',
      role: 'stage_musician',
      allowed_modules: USER_ROLE_PRESETS.stage_musician.defaultModules,
      must_change_password: true,
    });

    expect(newUser.email).toBe('baterista@tandu.com');
    expect(newUser.status).toBe('active');
    expect(newUser.must_change_password).toBe(true);
    expect(verifyUserPassword('StagePassword#2026', newUser)).toBe(true);
    expect(verifyUserPassword('WrongPassword', newUser)).toBe(false);

    // Stage musician has default access to practice (MP3 local), concert, setlists, editor, lyrics, mobile_inear
    expect(canUserAccessModule(newUser, 'practice')).toBe(true);
    expect(canUserAccessModule(newUser, 'concert')).toBe(true);
    expect(canUserAccessModule(newUser, 'setlists')).toBe(true);
    expect(canUserAccessModule(newUser, 'mobile_inear')).toBe(true);
    // Musician automatically lands on Practice MP3 (/practice) after app finishes loading
    expect(getFirstAllowedPathForUser(newUser)).toBe('/practice');
    // Does NOT have access to mastering, sample_lab, or users_admin
    expect(canUserAccessModule(newUser, 'mastering')).toBe(false);
    expect(canUserAccessModule(newUser, 'sample_lab')).toBe(false);
    expect(canUserAccessModule(newUser, 'users_admin')).toBe(false);

    // Legacy stage_musician created before 'practice' module existed auto-receives 'practice' access
    const legacyMusician = await createTanduUser({
      email: 'bajista@tandu.com',
      full_name: 'Mateo Bajo',
      password: 'StagePassword#2026',
      role: 'stage_musician',
      allowed_modules: ['concert', 'setlists'],
    });
    expect(canUserAccessModule(legacyMusician, 'practice')).toBe(true);
    expect(getFirstAllowedPathForUser(legacyMusician)).toBe('/practice');
  });

  it('deactivates (Dar de Baja), suspends, and reactivates users while enforcing immediate access revocation', async () => {
    const producer = await createTanduUser({
      email: 'productor@tandu.com',
      full_name: 'Elena Mastering',
      password: 'MasteringKey!99',
      role: 'studio_producer',
      allowed_modules: ['mastering', 'sample_lab', 'studio'],
    });

    expect(canUserAccessModule(producer, 'sample_lab')).toBe(true);
    expect(getFirstAllowedPathForUser(producer)).toBe('/mastering');

    // Dar de baja
    const deactivated = await setTanduUserStatus({
      userId: producer.id,
      status: 'inactive',
      reason: 'Fin de proyecto de mezcla',
    });

    expect(deactivated.status).toBe('inactive');
    expect(deactivated.deactivation_reason).toBe('Fin de proyecto de mezcla');
    expect(canUserAccessModule(deactivated, 'sample_lab')).toBe(false);
    expect(canUserAccessModule(deactivated, 'studio')).toBe(false);

    // Reactivar (Dar de Alta nuevamente)
    const reactivated = await setTanduUserStatus({
      userId: producer.id,
      status: 'active',
    });

    expect(reactivated.status).toBe('active');
    expect(reactivated.deactivation_reason).toBeNull();
    expect(canUserAccessModule(reactivated, 'sample_lab')).toBe(true);
  });

  it('updates password and granular module permissions accurately and logs audit trail', async () => {
    const editor = await createTanduUser({
      email: 'cms@tandu.com',
      full_name: 'Sofía Web',
      password: 'InitialPass!123',
      role: 'content_editor',
      allowed_modules: ['nacion_cms', 'design'],
    });

    expect(getFirstAllowedPathForUser(editor)).toBe('/nacion-cms');

    // Grant access to sample_lab and lyrics as well
    const updatedModulesUser = await updateTanduUser(editor.id, {
      role: 'custom',
      allowed_modules: ['nacion_cms', 'design', 'sample_lab', 'lyrics'],
    });

    expect(canUserAccessModule(updatedModulesUser, 'sample_lab')).toBe(true);
    expect(canUserAccessModule(updatedModulesUser, 'concert')).toBe(false);

    // Reset password
    const afterPwdReset = await changeTanduUserPassword({
      userId: editor.id,
      newPassword: 'NewSurgicalPassword$2026',
      mustChangeOnNextLogin: true,
    });

    expect(verifyUserPassword('InitialPass!123', afterPwdReset)).toBe(false);
    expect(verifyUserPassword('NewSurgicalPassword$2026', afterPwdReset)).toBe(true);
    expect(afterPwdReset.must_change_password).toBe(true);

    // Self change clears must_change_password
    const afterSelfChange = await changeTanduUserPassword({
      userId: editor.id,
      newPassword: 'PersonalFinalPassword#2026',
      isSelfChange: true,
    });
    expect(afterSelfChange.must_change_password).toBe(false);
    expect(verifyUserPassword('PersonalFinalPassword#2026', afterSelfChange)).toBe(true);

    const logs = readLocalAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  it('generates strong passwords and resolves routes to module definitions', () => {
    const generated = generateStrongPassword(14);
    expect(generated.length).toBe(14);
    const strength = evaluatePasswordStrength(generated);
    expect(strength.score).toBeGreaterThanOrEqual(3);

    expect(resolveModuleByPathname('/practice')?.id).toBe('practice');
    expect(resolveModuleByPathname('/concert')?.id).toBe('concert');
    expect(resolveModuleByPathname('/sample-lab')?.id).toBe('sample_lab');
    expect(resolveModuleByPathname('/admin/users')?.id).toBe('users_admin');
    expect(resolveModuleByPathname('/nacion-cms')?.id).toBe('nacion_cms');
  });
});
