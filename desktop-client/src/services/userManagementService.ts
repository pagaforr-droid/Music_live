import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  AppModuleCategory,
  AppModuleDefinition,
  AppModuleId,
  CreateTanduUserInput,
  PasswordStrengthResult,
  TanduUserProfile,
  UpdateTanduUserInput,
  UserAccountStatus,
  UserAuditActionType,
  UserAuditLogEntry,
  UserRoleId,
  UserRolePreset,
} from '../types/userManagement';

export const SYSTEM_OWNER_EMAILS = ['admin@tandu.com'] as const;

const LOCAL_USERS_STORAGE_KEY = 'tandu_users_registry_v1';
const LOCAL_AUDIT_STORAGE_KEY = 'tandu_users_audit_logs_v1';
const MANAGED_SESSION_STORAGE_KEY = 'tandu_managed_auth_session_v1';
export const USERS_UPDATED_EVENT = 'tandu:users-updated';

export const APP_MODULE_CATEGORIES: Record<
  AppModuleCategory,
  { label: string; description: string; accentColor: string }
> = {
  escenario: {
    label: 'Escenario en Vivo',
    description: 'Ejecución de concierto, repertorios y ruteo de hardware en directo.',
    accentColor: '#e11d48',
  },
  estudio: {
    label: 'Estudio & Producción',
    description: 'Separación de stems, masterización, reemplazo MIDI, letras y diseño.',
    accentColor: '#3b82f6',
  },
  web_cms: {
    label: 'Web Oficial & CMS',
    description: 'Administración de catálogo público, álbumes, videos, fotos y gira.',
    accentColor: '#f97316',
  },
  monitoreo: {
    label: 'Monitoreo Auxiliar',
    description: 'Mezcla personal In-Ear inalámbrica para músicos en escenario.',
    accentColor: '#f59e0b',
  },
  administracion: {
    label: 'Seguridad & Usuarios',
    description: 'Altas, bajas, gestión de contraseñas y control de accesos por módulo.',
    accentColor: '#10b981',
  },
};

export const APP_MODULES: AppModuleDefinition[] = [
  {
    id: 'concert',
    label: 'Live Concert',
    shortLabel: 'Live Concert',
    description: 'Motor principal de concierto en vivo, secuencias, metrónomo y teleprompter.',
    category: 'escenario',
    primaryPath: '/',
    matchPaths: ['/', '/concert'],
  },
  {
    id: 'setlists',
    label: 'Setlists & Show',
    shortLabel: 'Setlists',
    description: 'Diseño de repertorios, orden de canciones y estructura de shows.',
    category: 'escenario',
    primaryPath: '/setlists',
    matchPaths: ['/setlists'],
  },
  {
    id: 'soundcheck',
    label: 'Soundcheck & I/O',
    shortLabel: 'Soundcheck',
    description: 'Calibración de hardware de audio, ruteo multicanal y prueba de sonido.',
    category: 'escenario',
    primaryPath: '/soundcheck',
    matchPaths: ['/soundcheck'],
  },
  {
    id: 'studio',
    label: 'Stem Studio',
    shortLabel: 'Stem Studio',
    description: 'Importación multipista, separación de stems con IA y preparación de pistas.',
    category: 'estudio',
    primaryPath: '/studio',
    matchPaths: ['/studio'],
  },
  {
    id: 'mastering',
    label: 'Mastering Pro',
    shortLabel: 'Mastering Pro',
    description: 'Cadena de masterización quirúrgica, EQ Mid/Side, compresión y LUFS.',
    category: 'estudio',
    primaryPath: '/mastering',
    matchPaths: ['/mastering'],
  },
  {
    id: 'sample_lab',
    label: 'Sample Lab',
    shortLabel: 'Sample Lab',
    description: 'Reconocimiento neuronal de batería, edición MIDI DAW y reemplazo de samples.',
    category: 'estudio',
    primaryPath: '/sample-lab',
    matchPaths: ['/sample-lab'],
  },
  {
    id: 'editor',
    label: 'Studio Prompter',
    shortLabel: 'Prompter',
    description: 'Edición de cifrados, acordes, marcadores de sección y guiones de escenario.',
    category: 'estudio',
    primaryPath: '/editor',
    matchPaths: ['/editor'],
  },
  {
    id: 'lyrics',
    label: 'Lyric Studio',
    shortLabel: 'Lyric Studio',
    description: 'Sincronización milimétrica de letras y proyección visual para escenario.',
    category: 'estudio',
    primaryPath: '/lyrics',
    matchPaths: ['/lyrics'],
  },
  {
    id: 'design',
    label: 'Diseño & Stage',
    shortLabel: 'Diseño',
    description: 'Herramientas gráficas, visuales de escenario y recursos creativos.',
    category: 'estudio',
    primaryPath: '/design',
    matchPaths: ['/design'],
  },
  {
    id: 'nacion_cms',
    label: 'Contenido Web CMS',
    shortLabel: 'Web CMS',
    description: 'Gestión de álbumes, pistas, videos, galería fotográfica y fechas de gira.',
    category: 'web_cms',
    primaryPath: '/nacion-cms',
    matchPaths: ['/nacion-cms', '/admin/cms'],
  },
  {
    id: 'mobile_inear',
    label: 'In-Ear Monitor',
    shortLabel: 'In-Ear Wi-Fi',
    description: 'Consola móvil de monitoreo personal vía Wi-Fi para ensayos y directo.',
    category: 'monitoreo',
    primaryPath: '/mobile',
    matchPaths: ['/mobile'],
  },
  {
    id: 'users_admin',
    label: 'Usuarios & Accesos',
    shortLabel: 'Usuarios',
    description: 'Administración de usuarios, altas, bajas, contraseñas y permisos de módulos.',
    category: 'administracion',
    primaryPath: '/admin/users',
    matchPaths: ['/admin/users'],
    isCritical: true,
  },
];

export const ALL_MODULE_IDS: AppModuleId[] = APP_MODULES.map((m) => m.id);

export const USER_ROLE_PRESETS: Record<UserRoleId, UserRolePreset> = {
  super_admin: {
    id: 'super_admin',
    label: 'Super Administrador',
    badgeColor: '#e11d48',
    description: 'Control total del ecosistema, producción, escenario, CMS y gestión de usuarios.',
    defaultModules: [...ALL_MODULE_IDS],
  },
  studio_producer: {
    id: 'studio_producer',
    label: 'Productor de Estudio',
    badgeColor: '#3b82f6',
    description: 'Acceso completo a Stem Studio, Mastering Pro, Sample Lab, Prompter y Escenario.',
    defaultModules: [
      'concert',
      'setlists',
      'soundcheck',
      'studio',
      'mastering',
      'sample_lab',
      'editor',
      'lyrics',
    ],
  },
  live_engineer: {
    id: 'live_engineer',
    label: 'Ingeniero En Vivo (FOH)',
    badgeColor: '#10b981',
    description: 'Operación de concierto en directo, Soundcheck I/O, Setlists, Stems e In-Ear.',
    defaultModules: ['concert', 'setlists', 'soundcheck', 'studio', 'editor', 'mobile_inear'],
  },
  stage_musician: {
    id: 'stage_musician',
    label: 'Músico de Escenario',
    badgeColor: '#f59e0b',
    description: 'Acceso a Live Concert, Setlists, Studio Prompter, Lyric Studio y Monitoreo In-Ear.',
    defaultModules: ['concert', 'setlists', 'editor', 'lyrics', 'mobile_inear'],
  },
  content_editor: {
    id: 'content_editor',
    label: 'Editor Web & Diseño',
    badgeColor: '#f97316',
    description: 'Administración exclusiva del portal web CMS, catálogo multimedia y diseño.',
    defaultModules: ['nacion_cms', 'design', 'lyrics'],
  },
  custom: {
    id: 'custom',
    label: 'Acceso Personalizado',
    badgeColor: '#8b5cf6',
    description: 'Selección quirúrgica de módulos específicos asignados manualmente.',
    defaultModules: ['concert', 'setlists'],
  },
};

export const USER_MANAGEMENT_SQL_MIGRATION = `-- Ejecutar en Supabase Dashboard -> SQL Editor -> New Query -> Run
CREATE TABLE IF NOT EXISTS public.tandu_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'stage_musician'
    CHECK (role IN ('super_admin', 'studio_producer', 'live_engineer', 'stage_musician', 'content_editor', 'custom')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  allowed_modules JSONB NOT NULL DEFAULT '["concert","setlists"]'::jsonb,
  password_hash TEXT DEFAULT '',
  password_salt TEXT DEFAULT '',
  password_updated_at TIMESTAMPTZ DEFAULT now(),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  created_by TEXT DEFAULT 'admin@tandu.com',
  is_system_owner BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.tandu_user_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_email TEXT NOT NULL,
  target_name TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT 'admin@tandu.com',
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tandu_users_email ON public.tandu_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_tandu_users_status ON public.tandu_users(status);
CREATE INDEX IF NOT EXISTS idx_tandu_user_audit_created ON public.tandu_user_audit_logs(created_at DESC);

ALTER TABLE public.tandu_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tandu_user_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read tandu_users" ON public.tandu_users;
CREATE POLICY "Read tandu_users" ON public.tandu_users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Write tandu_users" ON public.tandu_users;
CREATE POLICY "Write tandu_users" ON public.tandu_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Read tandu_user_audit_logs" ON public.tandu_user_audit_logs;
CREATE POLICY "Read tandu_user_audit_logs" ON public.tandu_user_audit_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Write tandu_user_audit_logs" ON public.tandu_user_audit_logs;
CREATE POLICY "Write tandu_user_audit_logs" ON public.tandu_user_audit_logs FOR ALL USING (true) WITH CHECK (true);`;

// ============================================================================
// PURE FIPS 180-4 SHA-256 (Works identically in HTTPS, HTTP LAN, Tauri & Node)
// ============================================================================
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(asciiInput: string): string {
  const utf8 = new TextEncoder().encode(asciiInput);
  const bitLen = utf8.length * 8;
  const totalBytes = (((utf8.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(totalBytes);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalBytes - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalBytes - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

export function generateSalt(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function hashPasswordWithSalt(password: string, salt?: string): { hash: string; salt: string } {
  const effectiveSalt = salt || generateSalt(16);
  const hash = sha256Hex(`tandu_v1::${effectiveSalt}::${password}`);
  return { hash, salt: effectiveSalt };
}

export function verifyUserPassword(
  password: string,
  profile: Pick<TanduUserProfile, 'password_hash' | 'password_salt'>
): boolean {
  if (!profile.password_hash || !profile.password_salt) return false;
  const computed = sha256Hex(`tandu_v1::${profile.password_salt}::${password}`);
  return computed === profile.password_hash;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const suggestions: string[] = [];
  if (!password || password.length < 6) {
    return {
      score: 0,
      label: 'Muy Débil',
      color: '#ef4444',
      suggestions: ['Usa al menos 6 caracteres (recomendado 10 o más).'],
    };
  }

  let points = 0;
  if (password.length >= 6) points++;
  if (password.length >= 10) points++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) {
    points++;
  } else {
    suggestions.push('Combina mayúsculas y minúsculas.');
  }
  if (/\d/.test(password)) {
    points++;
  } else {
    suggestions.push('Incluye al menos un número.');
  }
  if (/[^A-Za-z0-9]/.test(password)) {
    points++;
  } else {
    suggestions.push('Agrega un símbolo especial (!@#$%&*).');
  }

  const score = Math.min(4, Math.max(1, points - 1)) as 1 | 2 | 3 | 4;
  const map: Record<1 | 2 | 3 | 4, { label: PasswordStrengthResult['label']; color: string }> = {
    1: { label: 'Débil', color: '#f97316' },
    2: { label: 'Aceptable', color: '#eab308' },
    3: { label: 'Fuerte', color: '#3b82f6' },
    4: { label: 'Quirúrgica', color: '#10b981' },
  };

  return {
    score,
    label: map[score].label,
    color: map[score].color,
    suggestions,
  };
}

export function generateStrongPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*+-=';
  const all = upper + lower + digits + symbols;

  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  const chars: string[] = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    chars.push(all[bytes[i] % all.length]);
  }

  // Deterministic Fisher-Yates shuffle using bytes
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

// ============================================================================
// SYSTEM OWNER & PERMISSIONS HELPERS
// ============================================================================
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export function isSystemOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  const norm = normalizeEmail(email);
  return SYSTEM_OWNER_EMAILS.some((owner) => owner.toLowerCase() === norm);
}

export function sanitizeAllowedModules(
  modules: unknown,
  role?: UserRoleId,
  email?: string | null
): AppModuleId[] {
  if (isSystemOwnerEmail(email) || role === 'super_admin') {
    return [...ALL_MODULE_IDS];
  }
  const validSet = new Set<AppModuleId>(ALL_MODULE_IDS);
  const rawList = Array.isArray(modules) ? modules : [];
  const filtered = rawList.filter((m): m is AppModuleId => validSet.has(m as AppModuleId));
  const unique = Array.from(new Set(filtered));
  if (unique.length === 0) {
    const fallbackRole = role && USER_ROLE_PRESETS[role] ? role : 'stage_musician';
    return [...USER_ROLE_PRESETS[fallbackRole].defaultModules];
  }
  return unique;
}

export function canUserAccessModule(
  profile: TanduUserProfile | null | undefined,
  moduleId: AppModuleId
): boolean {
  if (!profile) return false;
  if (profile.status !== 'active') return false;
  if (profile.is_system_owner || isSystemOwnerEmail(profile.email) || profile.role === 'super_admin') {
    return true;
  }
  return profile.allowed_modules.includes(moduleId);
}

export function resolveModuleByPathname(pathname: string): AppModuleDefinition | null {
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';
  for (const mod of APP_MODULES) {
    if (mod.matchPaths.some((p) => p === cleanPath)) {
      return mod;
    }
  }
  return null;
}

export function getFirstAllowedPathForUser(profile: TanduUserProfile | null | undefined): string {
  if (!profile) return '/login';
  if (profile.is_system_owner || isSystemOwnerEmail(profile.email) || profile.role === 'super_admin') {
    return '/';
  }
  for (const modId of profile.allowed_modules) {
    const found = APP_MODULES.find((m) => m.id === modId);
    if (found) return found.primaryPath;
  }
  return '/';
}

// ============================================================================
// LOCAL REGISTRY & EVENT BUS (Browser LocalStorage + Headless In-Memory Fallback)
// ============================================================================
let memoryUsersStore: TanduUserProfile[] | null = null;
let memoryAuditStore: UserAuditLogEntry[] = [];

export function clearMemoryUsersStore(): void {
  memoryUsersStore = null;
  memoryAuditStore = [];
}

function createDefaultOwnerProfile(): TanduUserProfile {
  const { hash, salt } = hashPasswordWithSalt('123456', 'tandu_owner_salt');
  const now = new Date().toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@tandu.com',
    full_name: 'Administrador Principal TANDU',
    title: 'Director General & Super Admin',
    role: 'super_admin',
    status: 'active',
    allowed_modules: [...ALL_MODULE_IDS],
    password_hash: hash,
    password_salt: salt,
    password_updated_at: now,
    must_change_password: false,
    notes: 'Cuenta maestra del sistema con acceso total e inmutable.',
    created_at: now,
    updated_at: now,
    last_login_at: now,
    deactivated_at: null,
    deactivation_reason: null,
    created_by: 'system',
    is_system_owner: true,
  };
}

export function dispatchUsersUpdatedEvent(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USERS_UPDATED_EVENT));
  }
}

export function subscribeToUsersUpdated(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(USERS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(USERS_UPDATED_EVENT, handler);
}

function normalizeUserRecord(raw: Partial<TanduUserProfile>): TanduUserProfile {
  const email = normalizeEmail(raw.email || '');
  const isOwner = Boolean(raw.is_system_owner || isSystemOwnerEmail(email));
  const role: UserRoleId = isOwner
    ? 'super_admin'
    : raw.role && USER_ROLE_PRESETS[raw.role]
      ? raw.role
      : 'stage_musician';
  const status: UserAccountStatus = isOwner
    ? 'active'
    : raw.status === 'inactive' || raw.status === 'suspended'
      ? raw.status
      : 'active';
  const now = new Date().toISOString();

  return {
    id: raw.id || generateUuid(),
    email,
    full_name: (raw.full_name || email.split('@')[0] || 'Usuario TANDU').trim(),
    title: (raw.title || USER_ROLE_PRESETS[role].label).trim(),
    role,
    status,
    allowed_modules: sanitizeAllowedModules(raw.allowed_modules, role, email),
    password_hash: raw.password_hash || '',
    password_salt: raw.password_salt || '',
    password_updated_at: raw.password_updated_at || raw.updated_at || now,
    must_change_password: isOwner ? false : Boolean(raw.must_change_password),
    notes: raw.notes || '',
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
    last_login_at: raw.last_login_at ?? null,
    deactivated_at: status === 'active' ? null : raw.deactivated_at || now,
    deactivation_reason: status === 'active' ? null : raw.deactivation_reason || null,
    created_by: raw.created_by || 'admin@tandu.com',
    is_system_owner: isOwner,
  };
}

export function readLocalUsersRegistry(): TanduUserProfile[] {
  const hasLocalStorage = typeof window !== 'undefined' && Boolean(window.localStorage);
  try {
    const raw = hasLocalStorage ? window.localStorage.getItem(LOCAL_USERS_STORAGE_KEY) : null;
    const parsed: Partial<TanduUserProfile>[] = raw
      ? JSON.parse(raw)
      : memoryUsersStore || [];
    const map = new Map<string, TanduUserProfile>();

    const defaultOwner = createDefaultOwnerProfile();
    map.set(defaultOwner.email, defaultOwner);

    for (const item of Array.isArray(parsed) ? parsed : []) {
      if (!item || !item.email) continue;
      const normalized = normalizeUserRecord(item);
      if (isSystemOwnerEmail(normalized.email)) {
        map.set(normalized.email, {
          ...defaultOwner,
          ...normalized,
          role: 'super_admin',
          status: 'active',
          allowed_modules: [...ALL_MODULE_IDS],
          is_system_owner: true,
          password_hash: normalized.password_hash || defaultOwner.password_hash,
          password_salt: normalized.password_salt || defaultOwner.password_salt,
        });
      } else {
        map.set(normalized.email, normalized);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.is_system_owner && !b.is_system_owner) return -1;
      if (!a.is_system_owner && b.is_system_owner) return 1;
      return a.full_name.localeCompare(b.full_name);
    });
  } catch {
    return [createDefaultOwnerProfile()];
  }
}

export function writeLocalUsersRegistry(users: TanduUserProfile[]): TanduUserProfile[] {
  const map = new Map<string, TanduUserProfile>();
  const defaultOwner = createDefaultOwnerProfile();
  map.set(defaultOwner.email, defaultOwner);

  for (const u of users) {
    if (!u || !u.email) continue;
    const normalized = normalizeUserRecord(u);
    if (isSystemOwnerEmail(normalized.email)) {
      const existingOwner = map.get(defaultOwner.email) || defaultOwner;
      map.set(normalized.email, {
        ...existingOwner,
        ...normalized,
        role: 'super_admin',
        status: 'active',
        allowed_modules: [...ALL_MODULE_IDS],
        is_system_owner: true,
        password_hash: normalized.password_hash || existingOwner.password_hash,
        password_salt: normalized.password_salt || existingOwner.password_salt,
      });
    } else {
      map.set(normalized.email, normalized);
    }
  }

  const finalUsers = Array.from(map.values()).sort((a, b) => {
    if (a.is_system_owner && !b.is_system_owner) return -1;
    if (!a.is_system_owner && b.is_system_owner) return 1;
    return a.full_name.localeCompare(b.full_name);
  });

  memoryUsersStore = finalUsers;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(finalUsers));
    } catch {
      // ignore storage quota errors
    }
  }
  return finalUsers;
}

export function readLocalAuditLogs(): UserAuditLogEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [...memoryAuditStore];
  try {
    const raw = window.localStorage.getItem(LOCAL_AUDIT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : memoryAuditStore;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [...memoryAuditStore];
  }
}

function appendLocalAuditLog(entry: UserAuditLogEntry): void {
  memoryAuditStore = [entry, ...memoryAuditStore].slice(0, 150);
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = readLocalAuditLogs();
    const next = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(0, 150);
    window.localStorage.setItem(LOCAL_AUDIT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// ============================================================================
// MANAGED AUTH SESSION (Supports Admin-Created & Admin-Password-Reset Users)
// ============================================================================
export function readManagedAuthSessionEmail(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(MANAGED_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string };
    return parsed?.email ? normalizeEmail(parsed.email) : null;
  } catch {
    return null;
  }
}

export function writeManagedAuthSessionEmail(email: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!email) {
      window.localStorage.removeItem(MANAGED_SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        MANAGED_SESSION_STORAGE_KEY,
        JSON.stringify({ email: normalizeEmail(email), logged_in_at: new Date().toISOString() })
      );
    }
  } catch {
    // ignore
  }
}

// ============================================================================
// SUPABASE HELPERS & ISOLATED AUTH CLIENT
// ============================================================================
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist') ||
    (msg.includes('relation') && msg.includes('not exist'))
  );
}

async function registerInSupabaseAuthIsolated(email: string, password: string, fullName: string): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseAnonKey) return;

  try {
    const isolatedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'tandu_isolated_admin_signup_tmp',
      },
    });
    await isolatedClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
  } catch {
    // Non-blocking: local + tandu_users password_hash verifier guarantees login even if Supabase Auth rate-limits
  }
}

async function recordAuditLog(params: {
  action: UserAuditActionType;
  targetUser: Pick<TanduUserProfile, 'id' | 'email' | 'full_name'>;
  actorEmail?: string;
  summary: string;
}): Promise<UserAuditLogEntry> {
  const entry: UserAuditLogEntry = {
    id: generateUuid(),
    action: params.action,
    target_user_id: params.targetUser.id,
    target_email: params.targetUser.email,
    target_name: params.targetUser.full_name,
    actor_email: normalizeEmail(params.actorEmail || 'admin@tandu.com') || 'admin@tandu.com',
    summary: params.summary,
    created_at: new Date().toISOString(),
  };

  appendLocalAuditLog(entry);

  try {
    await supabase.from('tandu_user_audit_logs').insert([entry]);
  } catch {
    // Local audit log already saved
  }

  return entry;
}

// ============================================================================
// CORE CRUD & SYNCHRONIZATION
// ============================================================================
export async function loadTanduUsersDirectory(): Promise<{
  users: TanduUserProfile[];
  auditLogs: UserAuditLogEntry[];
  missingSupabaseTable: boolean;
}> {
  const localUsers = readLocalUsersRegistry();
  const localMap = new Map<string, TanduUserProfile>(localUsers.map((u) => [u.email, u]));
  let missingSupabaseTable = false;

  try {
    const { data, error } = await supabase
      .from('tandu_users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTableError(error)) {
        missingSupabaseTable = true;
      }
    } else if (Array.isArray(data)) {
      for (const row of data) {
        if (!row || !row.email) continue;
        const remoteUser = normalizeUserRecord(row as Partial<TanduUserProfile>);
        const localExisting = localMap.get(remoteUser.email);

        if (!localExisting) {
          localMap.set(remoteUser.email, remoteUser);
        } else {
          const remoteTime = Date.parse(remoteUser.updated_at || '') || 0;
          const localTime = Date.parse(localExisting.updated_at || '') || 0;
          const newer = remoteTime >= localTime ? remoteUser : localExisting;
          localMap.set(remoteUser.email, {
            ...newer,
            password_hash: newer.password_hash || remoteUser.password_hash || localExisting.password_hash,
            password_salt: newer.password_salt || remoteUser.password_salt || localExisting.password_salt,
          });
        }
      }

      // Ensure local users that aren't in remote yet get synced up
      const remoteEmails = new Set(data.map((r: { email?: string }) => normalizeEmail(r.email || '')));
      for (const localU of localMap.values()) {
        if (!remoteEmails.has(localU.email)) {
          await supabase.from('tandu_users').upsert(localU, { onConflict: 'email' });
        }
      }
    }
  } catch {
    // Offline fallback uses localUsers
  }

  const mergedUsers = writeLocalUsersRegistry(Array.from(localMap.values()));

  let auditLogs = readLocalAuditLogs();
  if (!missingSupabaseTable) {
    try {
      const { data: remoteLogs } = await supabase
        .from('tandu_user_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (Array.isArray(remoteLogs) && remoteLogs.length > 0) {
        const logMap = new Map<string, UserAuditLogEntry>();
        for (const l of [...(remoteLogs as UserAuditLogEntry[]), ...auditLogs]) {
          if (l && l.id) logMap.set(l.id, l);
        }
        auditLogs = Array.from(logMap.values())
          .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
          .slice(0, 100);
      }
    } catch {
      // fallback to local logs
    }
  }

  return {
    users: mergedUsers,
    auditLogs,
    missingSupabaseTable,
  };
}

export function getLocalUserProfileByEmail(email?: string | null): TanduUserProfile | null {
  if (!email) return null;
  const norm = normalizeEmail(email);
  const users = readLocalUsersRegistry();
  return users.find((u) => u.email === norm) || null;
}

export async function resolveOrBootstrapUserProfile(email: string): Promise<TanduUserProfile> {
  const norm = normalizeEmail(email);
  const { users } = await loadTanduUsersDirectory();
  const existing = users.find((u) => u.email === norm);
  if (existing) return existing;

  // Auto-import any pre-existing authenticated Supabase user so existing accounts never break
  const now = new Date().toISOString();
  const isOwner = isSystemOwnerEmail(norm);
  const role: UserRoleId = isOwner ? 'super_admin' : 'studio_producer';
  const imported: TanduUserProfile = normalizeUserRecord({
    id: generateUuid(),
    email: norm,
    full_name: isOwner ? 'Administrador Principal TANDU' : norm.split('@')[0],
    title: USER_ROLE_PRESETS[role].label,
    role,
    status: 'active',
    allowed_modules: USER_ROLE_PRESETS[role].defaultModules,
    must_change_password: false,
    notes: 'Usuario importado automáticamente desde sesión activa.',
    created_at: now,
    updated_at: now,
    last_login_at: now,
    is_system_owner: isOwner,
  });

  writeLocalUsersRegistry([...users, imported]);
  try {
    await supabase.from('tandu_users').upsert(imported, { onConflict: 'email' });
  } catch {
    // non-blocking
  }
  dispatchUsersUpdatedEvent();
  return imported;
}

export async function createTanduUser(input: CreateTanduUserInput): Promise<TanduUserProfile> {
  const email = normalizeEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresa un correo electrónico válido.');
  }
  if (!input.full_name || !input.full_name.trim()) {
    throw new Error('El nombre completo del usuario es obligatorio.');
  }
  if (!input.password || input.password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const currentUsers = readLocalUsersRegistry();
  if (currentUsers.some((u) => u.email === email)) {
    throw new Error(`Ya existe un usuario registrado con el correo "${email}".`);
  }

  const { hash, salt } = hashPasswordWithSalt(input.password);
  const now = new Date().toISOString();
  const isOwner = isSystemOwnerEmail(email);
  const role: UserRoleId = isOwner ? 'super_admin' : input.role;
  const status: UserAccountStatus = isOwner ? 'active' : input.status || 'active';

  const newUser = normalizeUserRecord({
    id: generateUuid(),
    email,
    full_name: input.full_name.trim(),
    title: (input.title || USER_ROLE_PRESETS[role].label).trim(),
    role,
    status,
    allowed_modules: sanitizeAllowedModules(input.allowed_modules, role, email),
    password_hash: hash,
    password_salt: salt,
    password_updated_at: now,
    must_change_password: Boolean(input.must_change_password),
    notes: (input.notes || '').trim(),
    created_at: now,
    updated_at: now,
    last_login_at: null,
    deactivated_at: status === 'active' ? null : now,
    created_by: normalizeEmail(input.actorEmail || 'admin@tandu.com'),
    is_system_owner: isOwner,
  });

  writeLocalUsersRegistry([...currentUsers, newUser]);

  try {
    await supabase.from('tandu_users').upsert(newUser, { onConflict: 'email' });
  } catch {
    // saved in local registry
  }

  // Register in Supabase Auth using isolated non-persisting client
  await registerInSupabaseAuthIsolated(email, input.password, newUser.full_name);

  await recordAuditLog({
    action: 'USER_CREATED',
    targetUser: newUser,
    actorEmail: input.actorEmail,
    summary: `Alta de usuario (${USER_ROLE_PRESETS[newUser.role].label}) con acceso a ${newUser.allowed_modules.length} módulos.`,
  });

  dispatchUsersUpdatedEvent();
  return newUser;
}

export async function updateTanduUser(
  userId: string,
  input: UpdateTanduUserInput
): Promise<TanduUserProfile> {
  const currentUsers = readLocalUsersRegistry();
  const index = currentUsers.findIndex((u) => u.id === userId);
  if (index === -1) {
    throw new Error('No se encontró el usuario solicitado.');
  }

  const existing = currentUsers[index];
  const isOwner = existing.is_system_owner || isSystemOwnerEmail(existing.email);

  if (isOwner && input.status && input.status !== 'active') {
    throw new Error('Por seguridad del sistema, la cuenta maestra del Super Administrador no puede darse de baja.');
  }

  const nextRole: UserRoleId = isOwner ? 'super_admin' : input.role ?? existing.role;
  const nextStatus: UserAccountStatus = isOwner ? 'active' : input.status ?? existing.status;
  const nextModules = sanitizeAllowedModules(
    input.allowed_modules ?? existing.allowed_modules,
    nextRole,
    existing.email
  );
  const now = new Date().toISOString();

  const updated = normalizeUserRecord({
    ...existing,
    full_name: input.full_name !== undefined ? input.full_name.trim() || existing.full_name : existing.full_name,
    title: input.title !== undefined ? input.title.trim() : existing.title,
    role: nextRole,
    status: nextStatus,
    allowed_modules: nextModules,
    must_change_password:
      input.must_change_password !== undefined ? input.must_change_password : existing.must_change_password,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    updated_at: now,
    deactivated_at:
      nextStatus === 'active'
        ? null
        : existing.status === 'active'
          ? now
          : existing.deactivated_at || now,
    deactivation_reason:
      nextStatus === 'active'
        ? null
        : input.deactivation_reason !== undefined
          ? input.deactivation_reason
          : existing.deactivation_reason,
  });

  const nextUsers = [...currentUsers];
  nextUsers[index] = updated;
  writeLocalUsersRegistry(nextUsers);

  try {
    await supabase.from('tandu_users').upsert(updated, { onConflict: 'email' });
  } catch {
    // saved locally
  }

  let action: UserAuditActionType = 'USER_UPDATED';
  let summary = `Perfil actualizado (${USER_ROLE_PRESETS[updated.role].label}).`;

  if (existing.status !== updated.status) {
    if (updated.status === 'active') {
      action = 'USER_ACTIVATED';
      summary = 'Usuario reactivado (Dado de Alta).';
    } else if (updated.status === 'inactive') {
      action = 'USER_DEACTIVATED';
      summary = `Usuario dado de baja${updated.deactivation_reason ? `: ${updated.deactivation_reason}` : '.'}`;
    } else {
      action = 'USER_SUSPENDED';
      summary = `Usuario suspendido temporalmente${updated.deactivation_reason ? `: ${updated.deactivation_reason}` : '.'}`;
    }
  } else if (
    existing.allowed_modules.join(',') !== updated.allowed_modules.join(',') ||
    existing.role !== updated.role
  ) {
    action = 'MODULES_UPDATED';
    summary = `Permisos actualizados: ${updated.allowed_modules.length} módulos habilitados (${USER_ROLE_PRESETS[updated.role].label}).`;
  }

  await recordAuditLog({
    action,
    targetUser: updated,
    actorEmail: input.actorEmail,
    summary,
  });

  dispatchUsersUpdatedEvent();
  return updated;
}

export async function setTanduUserStatus(params: {
  userId: string;
  status: UserAccountStatus;
  reason?: string;
  actorEmail?: string;
}): Promise<TanduUserProfile> {
  return updateTanduUser(params.userId, {
    status: params.status,
    deactivation_reason: params.reason ?? null,
    actorEmail: params.actorEmail,
  });
}

export async function changeTanduUserPassword(params: {
  userId: string;
  newPassword: string;
  mustChangeOnNextLogin?: boolean;
  actorEmail?: string;
  isSelfChange?: boolean;
}): Promise<TanduUserProfile> {
  if (!params.newPassword || params.newPassword.length < 6) {
    throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
  }

  const currentUsers = readLocalUsersRegistry();
  const index = currentUsers.findIndex((u) => u.id === params.userId);
  if (index === -1) {
    throw new Error('No se encontró el usuario.');
  }

  const existing = currentUsers[index];
  const { hash, salt } = hashPasswordWithSalt(params.newPassword);
  const now = new Date().toISOString();

  const updated: TanduUserProfile = {
    ...existing,
    password_hash: hash,
    password_salt: salt,
    password_updated_at: now,
    must_change_password: params.isSelfChange ? false : Boolean(params.mustChangeOnNextLogin),
    updated_at: now,
  };

  const nextUsers = [...currentUsers];
  nextUsers[index] = updated;
  writeLocalUsersRegistry(nextUsers);

  try {
    await supabase.from('tandu_users').upsert(updated, { onConflict: 'email' });
  } catch {
    // saved locally
  }

  // If the currently signed-in Supabase user is updating their own password, also update Supabase Auth directly
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const activeEmail = normalizeEmail(sessionData.session?.user?.email || '');
    if (activeEmail && activeEmail === existing.email) {
      await supabase.auth.updateUser({ password: params.newPassword });
    }
  } catch {
    // non-blocking
  }

  await recordAuditLog({
    action: 'PASSWORD_CHANGED',
    targetUser: updated,
    actorEmail: params.actorEmail || existing.email,
    summary: params.isSelfChange
      ? 'El usuario actualizó su propia contraseña.'
      : `Contraseña restablecida por administrador${updated.must_change_password ? ' (cambio requerido al ingresar)' : ''}.`,
  });

  dispatchUsersUpdatedEvent();
  return updated;
}

export async function deleteTanduUser(params: {
  userId: string;
  actorEmail?: string;
}): Promise<void> {
  const currentUsers = readLocalUsersRegistry();
  const target = currentUsers.find((u) => u.id === params.userId);
  if (!target) {
    throw new Error('El usuario no existe.');
  }
  if (target.is_system_owner || isSystemOwnerEmail(target.email)) {
    throw new Error('No se puede eliminar la cuenta maestra del Super Administrador del sistema.');
  }
  if (params.actorEmail && normalizeEmail(params.actorEmail) === target.email) {
    throw new Error('No puedes eliminar tu propia cuenta con sesión activa.');
  }

  const remaining = currentUsers.filter((u) => u.id !== params.userId);
  writeLocalUsersRegistry(remaining);

  try {
    await supabase.from('tandu_users').delete().eq('id', target.id);
    await supabase.from('tandu_users').delete().eq('email', target.email);
  } catch {
    // local already updated
  }

  await recordAuditLog({
    action: 'USER_DELETED',
    targetUser: target,
    actorEmail: params.actorEmail,
    summary: `Usuario eliminado definitivamente del sistema (${target.email}).`,
  });

  dispatchUsersUpdatedEvent();
}

export async function recordUserLoginSuccess(email: string): Promise<TanduUserProfile> {
  const profile = await resolveOrBootstrapUserProfile(email);
  const now = new Date().toISOString();
  const updated: TanduUserProfile = {
    ...profile,
    last_login_at: now,
  };
  const users = readLocalUsersRegistry();
  writeLocalUsersRegistry(users.map((u) => (u.email === updated.email ? updated : u)));
  try {
    await supabase
      .from('tandu_users')
      .update({ last_login_at: now })
      .eq('email', updated.email);
  } catch {
    // non-blocking
  }
  dispatchUsersUpdatedEvent();
  return updated;
}
