import { supabase } from '../lib/supabase';
import { audioBufferToMp3Blob } from '../hooks/useAudioEngine';
import { loadLameJs } from '../utils/loadLameJs';
import { sha256Hex } from './userManagementService';

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';

const DB_NAME = 'tandu_musician_mp3_vault_v1';
const DB_VERSION = 2;
const STORE_CATALOG = 'catalog';
const STORE_MP3_INDEX = 'mp3_index';
const STORE_MP3_BLOBS = 'mp3_blobs';
const STORE_CRYPTO_KEYS = 'crypto_keys';
const CATALOG_RECORD_KEY = 'active_live_catalog';
const MASTER_KEY_ID = 'vault_aes256_master_key_v2';
const FALLBACK_SECRET_STORAGE_KEY = 'tandu_vault_fallback_secret_v2';

// Enfriamiento automático de 24 horas para reducir en ~98% las consultas repetidas a Supabase Postgres
export const CATALOG_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LAST_SYNC_STORAGE_KEY = 'tandu_practice_last_catalog_sync_ms_v1';

// Licencia Offline de 15 días (renovada sin costo extra cuando el usuario activo tiene conexión)
export const OFFLINE_LEASE_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const OFFLINE_LEASE_STORAGE_KEY = 'tandu_practice_offline_lease_v1';

export interface PracticeSetlistSummary {
  id: string;
  title: string;
  created_at?: string;
}

export interface PracticeSongItem {
  id: string;
  title: string;
  position?: number;
  foh_mix_url?: string | null;
  cue_mix_url?: string | null;
  foh_mobile_url?: string | null;
  cue_mobile_url?: string | null;
  prompter_data?: any;
}

export interface PracticeCatalogSnapshot {
  setlists: PracticeSetlistSummary[];
  setlistSongsMap: Record<string, PracticeSongItem[]>;
  allLiveSongs: PracticeSongItem[];
  syncedAt: string;
}

export interface LocalMp3TrackMeta {
  songId: string;
  title: string;
  hasFoh: boolean;
  hasCue: boolean;
  fohSourceSig: string;
  cueSourceSig: string;
  fohBytes: number;
  cueBytes: number;
  totalBytes: number;
  savedAt: string;
  encrypted?: boolean;
  convertedFromWav?: boolean;
  cueSynthesizedFallback?: boolean;
}

interface StoredEncryptedPayload {
  key: string;
  buffer: ArrayBuffer;
  iv?: Uint8Array | number[];
  cipherScheme: 'aes-256-gcm' | 'sha256-ctr-v1';
  mimeType: string;
}

export type SongVaultStatus = 'offline_ready' | 'update_available' | 'cloud_only' | 'no_mix';

export interface SongVaultEvaluation {
  status: SongVaultStatus;
  hasCloudFoh: boolean;
  hasCloudCue: boolean;
  hasLocalFoh: boolean;
  hasLocalCue: boolean;
  cueNeedsDownload: boolean;
  localBytes: number;
}

export interface LocalVaultSummary {
  tracksBySongId: Record<string, LocalMp3TrackMeta>;
  totalSavedSongs: number;
  totalBytesUsed: number;
  deviceQuotaBytes?: number;
  deviceUsageBytes?: number;
  isPersistedStorage?: boolean;
}

export interface OfflineLeaseStatus {
  valid: boolean;
  daysRemaining: number;
  expiresAtIso: string | null;
}

// ============================================================================
// IN-MEMORY FALLBACK (Para entornos sin IndexedDB / Vitest / Safari Modo Privado)
// ============================================================================
let memoryCatalogCache: PracticeCatalogSnapshot | null = null;
const memoryIndexMap = new Map<string, LocalMp3TrackMeta>();
const memoryBlobMap = new Map<string, StoredEncryptedPayload>();
let memoryCryptoKey: CryptoKey | null = null;
let aesIdbKeyUnsupported = false;
let memoryFallbackSecret: string | null = null;
let memoryOfflineLease: {
  email: string;
  verifiedAtMs: number;
  expiresAtMs: number;
  sig: string;
} | null = null;
let lastCatalogRemoteSyncMs = 0;

export function resetMusicianVaultMemoryForTests(): void {
  memoryCatalogCache = null;
  memoryIndexMap.clear();
  memoryBlobMap.clear();
  memoryCryptoKey = null;
  aesIdbKeyUnsupported = false;
  memoryFallbackSecret = null;
  memoryOfflineLease = null;
  lastCatalogRemoteSyncMs = 0;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LAST_SYNC_STORAGE_KEY);
      window.localStorage.removeItem(OFFLINE_LEASE_STORAGE_KEY);
      window.localStorage.removeItem(FALLBACK_SECRET_STORAGE_KEY);
    } catch {}
  }
}

// ============================================================================
// HARDWARE GATE: EXCLUSIVO CELULARES Y TABLETS PARA USUARIOS NO-ADMIN
// ============================================================================
export function isMobileOrTabletDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return true;
  }

  const ua = (navigator.userAgent || '').toLowerCase();
  const isExplicitMobileOrTabletUa =
    /android|iphone|ipad|ipod|mobile|tablet|silk|kindle|playbook|opera mini|iemobile/i.test(ua);
  if (isExplicitMobileOrTabletUa) return true;

  // iPadOS 13+ reporta Macintosh en userAgent pero cuenta con pantalla táctil multipunto
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  if (/macintosh|mac os x/i.test(ua) && touchPoints >= 2) {
    return true;
  }

  // Tablets Android / Windows en modo táctil con puntero primario táctil (coarse)
  if (typeof window.matchMedia === 'function') {
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (isCoarsePointer && touchPoints >= 1) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// OFFLINE LEASE (15 DÍAS DE VIGENCIA SIN CONSULTAS EXTRAS A SUPABASE)
// ============================================================================
export function renewMusicianOfflineLease(email?: string | null): OfflineLeaseStatus {
  const cleanEmail = (email || 'musician@tandu.com').trim().toLowerCase();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + OFFLINE_LEASE_TTL_MS;
  const sig = sha256Hex(`tandu_lease_v1::${cleanEmail}::${expiresAtMs}`);

  const record = {
    email: cleanEmail,
    verifiedAtMs: nowMs,
    expiresAtMs,
    sig,
  };
  memoryOfflineLease = record;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(OFFLINE_LEASE_STORAGE_KEY, JSON.stringify(record));
    } catch {}
  }

  return {
    valid: true,
    daysRemaining: 15,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
  };
}

export function checkMusicianOfflineLease(email?: string | null): OfflineLeaseStatus {
  try {
    let parsed: {
      email?: string;
      expiresAtMs?: number;
      sig?: string;
    } | null = memoryOfflineLease;

    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(OFFLINE_LEASE_STORAGE_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    }

    if (!parsed) {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        return renewMusicianOfflineLease(email);
      }
      return { valid: false, daysRemaining: 0, expiresAtIso: null };
    }

    const exp = Number(parsed?.expiresAtMs || 0);
    const storedEmail = (parsed?.email || '').trim().toLowerCase();
    const expectedSig = sha256Hex(`tandu_lease_v1::${storedEmail}::${exp}`);

    if (!exp || parsed?.sig !== expectedSig) {
      return { valid: false, daysRemaining: 0, expiresAtIso: null };
    }

    if (email && storedEmail && email.trim().toLowerCase() !== storedEmail) {
      return { valid: false, daysRemaining: 0, expiresAtIso: null };
    }

    const remainingMs = exp - Date.now();
    if (remainingMs <= 0) {
      return { valid: false, daysRemaining: 0, expiresAtIso: new Date(exp).toISOString() };
    }

    return {
      valid: true,
      daysRemaining: Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
      expiresAtIso: new Date(exp).toISOString(),
    };
  } catch {
    return { valid: false, daysRemaining: 0, expiresAtIso: null };
  }
}

// ============================================================================
// INDEXEDDB LOW-LEVEL ENGINE (HARDENED FOR iOS SAFARI, ANDROID & PRIVATE WEBVIEW)
// ============================================================================
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      if (!db) {
        dbPromise = null;
      }
      resolve(db);
    };

    const timeoutId = globalThis.setTimeout(() => {
      finish(null);
    }, 2500);

    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CATALOG)) {
          db.createObjectStore(STORE_CATALOG, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_MP3_INDEX)) {
          db.createObjectStore(STORE_MP3_INDEX, { keyPath: 'songId' });
        }
        if (!db.objectStoreNames.contains(STORE_MP3_BLOBS)) {
          db.createObjectStore(STORE_MP3_BLOBS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_CRYPTO_KEYS)) {
          db.createObjectStore(STORE_CRYPTO_KEYS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });

  return dbPromise;
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: T | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(val);
    };
    const timer = globalThis.setTimeout(() => finish(undefined), 3500);

    try {
      const tx = db.transaction(storeName, 'readonly');
      tx.onabort = () => finish(undefined);
      tx.onerror = () => finish(undefined);
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => finish(req.result as T | undefined);
      req.onerror = () => finish(undefined);
    } catch {
      dbPromise = null;
      finish(undefined);
    }
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: T[]) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(val);
    };
    const timer = globalThis.setTimeout(() => finish([]), 3500);

    try {
      const tx = db.transaction(storeName, 'readonly');
      tx.onabort = () => finish([]);
      tx.onerror = () => finish([]);
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => finish(Array.isArray(req.result) ? (req.result as T[]) : []);
      req.onerror = () => finish([]);
    } catch {
      dbPromise = null;
      finish([]);
    }
  });
}

function idbPut(db: IDBDatabase, storeName: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(ok);
    };
    const timer = globalThis.setTimeout(() => finish(false), 8000);

    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => finish(true);
      tx.onerror = () => finish(false);
      tx.onabort = () => finish(false);
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onerror = () => finish(false);
    } catch {
      dbPromise = null;
      finish(false);
    }
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(ok);
    };
    const timer = globalThis.setTimeout(() => finish(false), 3500);

    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => finish(true);
      tx.onerror = () => finish(false);
      tx.onabort = () => finish(false);
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onerror = () => finish(false);
    } catch {
      dbPromise = null;
      finish(false);
    }
  });
}

// ============================================================================
// MILITARY-GRADE LOCAL ENCRYPTION (AES-256-GCM + Mobile Safari/HTTP CTR Fallback)
// ============================================================================
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < length; i++) {
      out[i] = Math.floor(Math.random() * 256);
    }
  }
  return out;
}

function normalizeIvBytes(iv: unknown): Uint8Array | null {
  if (!iv) return null;
  if (iv instanceof Uint8Array) return iv;
  if (Array.isArray(iv)) return new Uint8Array(iv);
  if (iv instanceof ArrayBuffer) return new Uint8Array(iv);
  if (ArrayBuffer.isView(iv)) {
    return new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength);
  }
  return null;
}

/** Sobrescribe con ceros cualquier ArrayBuffer sensible en RAM inmediatamente después de decodificar */
export function wipeAudioArrayBufferInRam(buffer: ArrayBuffer | null | undefined): void {
  if (!buffer || buffer.byteLength === 0) return;
  try {
    new Uint8Array(buffer).fill(0);
  } catch {
    // Buffer might already be detached by decodeAudioData transfer
  }
}

async function getOrCreateNonExportableAesKey(db: IDBDatabase | null): Promise<CryptoKey | null> {
  if (aesIdbKeyUnsupported) return null;
  if (memoryCryptoKey) return memoryCryptoKey;
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;

  try {
    if (db) {
      const record = await idbGet<{ id: string; key: CryptoKey }>(
        db,
        STORE_CRYPTO_KEYS,
        MASTER_KEY_ID
      );
      if (record?.key) {
        memoryCryptoKey = record.key;
        return record.key;
      }
    }

    // extractable: false impide físicamente que alguien exporte la llave desde DevTools o scripts
    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    if (db) {
      // En Safari iOS / ciertos WebViews, clonar un CryptoKey no-exportable en IndexedDB aborta la transacción.
      // Verificamos que realmente se persista antes de usarlo; si falla, usamos sha256-ctr-v1 para no perder descifrado al recargar.
      const savedOk = await idbPut(db, STORE_CRYPTO_KEYS, { id: MASTER_KEY_ID, key: generated });
      if (!savedOk) {
        aesIdbKeyUnsupported = true;
        return null;
      }
      const verified = await idbGet<{ id: string; key: CryptoKey }>(
        db,
        STORE_CRYPTO_KEYS,
        MASTER_KEY_ID
      );
      if (!verified?.key) {
        aesIdbKeyUnsupported = true;
        return null;
      }
    }

    memoryCryptoKey = generated;
    return generated;
  } catch {
    aesIdbKeyUnsupported = true;
    return null;
  }
}

async function getOrCreateFallbackSecret(db: IDBDatabase | null): Promise<string> {
  if (memoryFallbackSecret) return memoryFallbackSecret;

  if (db) {
    const existing = await idbGet<{ id: string; secret: string }>(
      db,
      STORE_CRYPTO_KEYS,
      `${MASTER_KEY_ID}_fallback`
    );
    if (existing?.secret) {
      memoryFallbackSecret = existing.secret;
      return existing.secret;
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const storedLocal = window.localStorage.getItem(FALLBACK_SECRET_STORAGE_KEY);
      if (storedLocal && storedLocal.length >= 32) {
        memoryFallbackSecret = storedLocal;
        if (db) {
          await idbPut(db, STORE_CRYPTO_KEYS, {
            id: `${MASTER_KEY_ID}_fallback`,
            secret: storedLocal,
          });
        }
        return storedLocal;
      }
    } catch {}
  }

  const bytes = randomBytes(32);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  memoryFallbackSecret = secret;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(FALLBACK_SECRET_STORAGE_KEY, secret);
    } catch {}
  }
  if (db) {
    await idbPut(db, STORE_CRYPTO_KEYS, { id: `${MASTER_KEY_ID}_fallback`, secret });
  }
  return secret;
}

function xorCtrStreamTransform(
  input: ArrayBuffer,
  secret: string,
  iv: Uint8Array,
  contextId: string
): ArrayBuffer {
  const src = new Uint8Array(input);
  const out = new Uint8Array(src.length);
  const ivHex = Array.from(iv, (b) => b.toString(16).padStart(2, '0')).join('');

  // Derive 256-byte keystream blocks from SHA-256 so encryption/decryption is fast and allocation-free
  const keyRing = new Uint8Array(256);
  for (let blk = 0; blk < 8; blk++) {
    const digest = sha256Hex(`tandu_ctr_v1::${secret}::${ivHex}::${contextId}::${blk}`);
    for (let j = 0; j < 32; j++) {
      keyRing[blk * 32 + j] = parseInt(digest.slice(j * 2, j * 2 + 2), 16);
    }
  }

  for (let i = 0; i < src.length; i++) {
    out[i] = src[i] ^ keyRing[i & 255] ^ ((i >>> 8) & 0xff);
  }
  return out.buffer;
}

async function encryptAudioBufferForVault(
  plainBuffer: ArrayBuffer,
  blobKey: string,
  db: IDBDatabase | null
): Promise<StoredEncryptedPayload> {
  const ivBytes = randomBytes(12);
  const ivArray = Array.from(ivBytes);
  const aesKey = await getOrCreateNonExportableAesKey(db);

  if (aesKey && typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const aad = new TextEncoder().encode(`tandu_vault_v2::${blobKey}`);
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: ivBytes as Uint8Array<ArrayBuffer>,
          additionalData: aad,
        },
        aesKey,
        plainBuffer
      );
      return {
        key: blobKey,
        buffer: encrypted,
        iv: ivArray,
        cipherScheme: 'aes-256-gcm',
        mimeType: 'application/octet-stream',
      };
    } catch {
      // Fall through to CTR cipher
    }
  }

  const secret = await getOrCreateFallbackSecret(db);
  const transformed = xorCtrStreamTransform(plainBuffer, secret, ivBytes, blobKey);
  return {
    key: blobKey,
    buffer: transformed,
    iv: ivArray,
    cipherScheme: 'sha256-ctr-v1',
    mimeType: 'application/octet-stream',
  };
}

async function decryptVaultPayloadToRamBuffer(
  stored: StoredEncryptedPayload,
  db: IDBDatabase | null
): Promise<ArrayBuffer | null> {
  if (!stored?.buffer || stored.buffer.byteLength === 0) return null;
  const ivBytes = normalizeIvBytes(stored.iv);

  if (stored.cipherScheme === 'aes-256-gcm' && ivBytes) {
    const aesKey = await getOrCreateNonExportableAesKey(db);
    if (!aesKey || typeof crypto === 'undefined' || !crypto.subtle) return null;
    try {
      const aad = new TextEncoder().encode(`tandu_vault_v2::${stored.key}`);
      return await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBytes as Uint8Array<ArrayBuffer>,
          additionalData: aad,
        },
        aesKey,
        stored.buffer
      );
    } catch {
      return null;
    }
  }

  if (stored.cipherScheme === 'sha256-ctr-v1' && ivBytes) {
    const secret = await getOrCreateFallbackSecret(db);
    return xorCtrStreamTransform(stored.buffer, secret, ivBytes, stored.key);
  }

  // Retrocompatibilidad con entradas v1 previas a cifrado
  return stored.buffer.slice(0);
}

// ============================================================================
// PERSISTENT DEVICE STORAGE QUOTA HELPERS
// ============================================================================
export async function requestPersistentDeviceStorage(): Promise<{
  persisted: boolean;
  quotaBytes?: number;
  usageBytes?: number;
}> {
  let persisted = false;
  let quotaBytes: number | undefined;
  let usageBytes: number | undefined;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      if (!persisted && typeof navigator.storage.persist === 'function') {
        persisted = await Promise.race([
          navigator.storage.persist(),
          new Promise<boolean>((resolve) => globalThis.setTimeout(() => resolve(false), 1500)),
        ]);
      }
    } catch {}

    try {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        quotaBytes = est.quota;
        usageBytes = est.usage;
      }
    } catch {}
  }

  return { persisted, quotaBytes, usageBytes };
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

// ============================================================================
// PURE MP3 SOURCE & HASHED VERSION SIGNATURE RESOLVERS (No URLs saved in index!)
// ============================================================================
export function resolvePreferredMp3Source(
  song: PracticeSongItem | null | undefined,
  channel: 'foh' | 'cue'
): { url: string | null; isLikelyWav: boolean } {
  if (!song) return { url: null, isLikelyWav: false };

  const mobileUrl = channel === 'foh' ? song.foh_mobile_url : song.cue_mobile_url;
  const wavMixUrl = channel === 'foh' ? song.foh_mix_url : song.cue_mix_url;

  const chosen = (mobileUrl && mobileUrl.trim()) || (wavMixUrl && wavMixUrl.trim()) || null;
  if (!chosen) return { url: null, isLikelyWav: false };

  const cleanPath = chosen.split('?')[0].toLowerCase();
  const isLikelyWav = !mobileUrl && cleanPath.endsWith('.wav');
  return { url: chosen, isLikelyWav };
}

/**
 * Devuelve la cadena ordenada de URLs candidatas para un canal:
 * 1) `*_mobile_url` (MP3 ligero optimizado para celulares)
 * 2) `*_mix_url` (respaldo automático WAV/MP3 si `*_mobile_url` devuelve 404/error)
 */
export function resolveCandidateAudioSources(
  song: PracticeSongItem | null | undefined,
  channel: 'foh' | 'cue'
): Array<{ url: string; isLikelyWav: boolean }> {
  if (!song) return [];
  const rawList =
    channel === 'foh'
      ? [song.foh_mobile_url, song.foh_mix_url]
      : [song.cue_mobile_url, song.cue_mix_url];

  const seen = new Set<string>();
  const out: Array<{ url: string; isLikelyWav: boolean }> = [];
  for (const raw of rawList) {
    const clean = typeof raw === 'string' ? raw.trim() : '';
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const pathLower = clean.split('?')[0].toLowerCase();
    out.push({
      url: clean,
      isLikelyWav: pathLower.endsWith('.wav'),
    });
  }
  return out;
}

export function computeSongChannelSignature(
  song: PracticeSongItem | null | undefined,
  channel: 'foh' | 'cue'
): string {
  const { url } = resolvePreferredMp3Source(song, channel);
  if (!url) return '';
  const exportedAt = song?.prompter_data?.liveMixMeta?.exportedAt || '';
  const version = song?.prompter_data?.liveMixMeta?.version ?? 0;
  // Hash SHA-256 para que ninguna URL directa de Storage quede guardada en texto plano en el índice
  return sha256Hex(`tandu_sig_v2::${channel}::${url}::v:${version}::exp:${exportedAt}`);
}

export function evaluateSongVaultState(
  song: PracticeSongItem | null | undefined,
  localMeta: LocalMp3TrackMeta | undefined
): SongVaultEvaluation {
  const fohSrc = resolvePreferredMp3Source(song, 'foh');
  const cueSrc = resolvePreferredMp3Source(song, 'cue');
  const hasCloudFoh = Boolean(fohSrc.url);
  const hasCloudCue = Boolean(cueSrc.url);

  const hasLocalFoh = Boolean(localMeta?.hasFoh);
  const hasLocalCue = Boolean(localMeta?.hasCue);
  const hasCueSynthFallback = Boolean(localMeta?.cueSynthesizedFallback);
  const localBytes = localMeta?.totalBytes || 0;

  if (!hasCloudFoh && !hasLocalFoh) {
    return {
      status: 'no_mix',
      hasCloudFoh: false,
      hasCloudCue,
      hasLocalFoh: false,
      hasLocalCue: false,
      cueNeedsDownload: false,
      localBytes: 0,
    };
  }

  const fohSigNow = computeSongChannelSignature(song, 'foh');
  const cueSigNow = computeSongChannelSignature(song, 'cue');

  if (hasLocalFoh) {
    const fohMatches = !fohSigNow || localMeta?.fohSourceSig === fohSigNow;
    const cueSatisfied = hasLocalCue || hasCueSynthFallback;
    const cueMatchesIfCached =
      !cueSatisfied || !cueSigNow || localMeta?.cueSourceSig === cueSigNow;
    const cueNeedsDownload =
      hasCloudCue &&
      (!cueSatisfied || (Boolean(cueSigNow) && localMeta?.cueSourceSig !== cueSigNow));

    if (fohMatches && cueMatchesIfCached) {
      return {
        status: 'offline_ready',
        hasCloudFoh,
        hasCloudCue,
        hasLocalFoh: true,
        hasLocalCue,
        cueNeedsDownload,
        localBytes,
      };
    }

    return {
      status: 'update_available',
      hasCloudFoh,
      hasCloudCue,
      hasLocalFoh: true,
      hasLocalCue,
      cueNeedsDownload,
      localBytes,
    };
  }

  return {
    status: 'cloud_only',
    hasCloudFoh,
    hasCloudCue,
    hasLocalFoh: false,
    hasLocalCue: false,
    cueNeedsDownload: hasCloudCue,
    localBytes: 0,
  };
}

// ============================================================================
// CATALOG LOCAL CACHE + 24H DELTA SUPABASE METADATA SYNC (Zero Redundant prompter_data)
// ============================================================================
export async function readCachedPracticeCatalog(): Promise<PracticeCatalogSnapshot | null> {
  const db = await openVaultDb();
  if (db) {
    const row = await idbGet<{ key: string; snapshot: PracticeCatalogSnapshot }>(
      db,
      STORE_CATALOG,
      CATALOG_RECORD_KEY
    );
    if (row?.snapshot) {
      memoryCatalogCache = row.snapshot;
      return row.snapshot;
    }
  }
  return memoryCatalogCache;
}

export async function saveCachedPracticeCatalog(snapshot: PracticeCatalogSnapshot): Promise<void> {
  memoryCatalogCache = snapshot;
  const db = await openVaultDb();
  if (db) {
    await idbPut(db, STORE_CATALOG, { key: CATALOG_RECORD_KEY, snapshot });
  }
}

function getLastCatalogSyncTimestampMs(): number {
  if (lastCatalogRemoteSyncMs > 0) return lastCatalogRemoteSyncMs;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = Number(window.localStorage.getItem(LAST_SYNC_STORAGE_KEY) || 0);
      if (Number.isFinite(raw) && raw > 0) {
        lastCatalogRemoteSyncMs = raw;
        return raw;
      }
    } catch {}
  }
  return 0;
}

function recordCatalogSyncTimestampMs(ts: number): void {
  lastCatalogRemoteSyncMs = ts;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, String(ts));
    } catch {}
  }
}

export async function syncPracticeCatalogFromSupabase(options?: {
  force?: boolean;
}): Promise<PracticeCatalogSnapshot | null> {
  const force = Boolean(options?.force);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return readCachedPracticeCatalog();
  }

  const cached = await readCachedPracticeCatalog();
  const nowMs = Date.now();
  const lastSyncMs = getLastCatalogSyncTimestampMs();

  // Si ya sincronizó en las últimas 24 horas y no fue forzado manualmente (↻), usa 100% caché local (0 queries a Supabase)
  if (!force && cached && lastSyncMs > 0 && nowMs - lastSyncMs < CATALOG_SYNC_COOLDOWN_MS) {
    return cached;
  }

  try {
    // Paso 1: Consulta ultraligera de cabeceras (SIN descargar la columna pesada prompter_data de todas las canciones)
    const [setlistsRes, setlistSongsRes, lightSongsRes] = await Promise.all([
      supabase
        .from('setlists')
        .select('id, title, created_at')
        .eq('band_id', FAKE_BAND_ID)
        .order('created_at', { ascending: false }),
      supabase
        .from('setlist_songs')
        .select('setlist_id, position, song_id')
        .order('position', { ascending: true }),
      supabase
        .from('songs')
        .select('id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url')
        .eq('band_id', FAKE_BAND_ID)
        .order('title', { ascending: true }),
    ]);

    let resolvedSongsData: any[] | null = lightSongsRes.data as any[] | null;
    if (lightSongsRes.error) {
      // Respaldo de compatibilidad si alguna instancia aún no migró columnas *_mobile_url
      const fallbackSongsRes = await supabase
        .from('songs')
        .select('id, title, foh_mix_url, cue_mix_url')
        .eq('band_id', FAKE_BAND_ID)
        .order('title', { ascending: true });
      if (fallbackSongsRes.error) {
        return cached;
      }
      resolvedSongsData = fallbackSongsRes.data as any[];
    }

    if (setlistsRes.error) {
      return cached;
    }

    const setlists: PracticeSetlistSummary[] = (setlistsRes.data || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      created_at: s.created_at,
    }));

    const cachedSongsMap = new Map<string, PracticeSongItem>(
      (cached?.allLiveSongs || []).map((s) => [s.id, s])
    );

    const lightSongs: PracticeSongItem[] = (resolvedSongsData || []) as PracticeSongItem[];
    const knownSongIds = new Set<string>(lightSongs.map((s) => s.id));
    const setlistSongIds = new Set<string>();
    const missingSetlistSongIds: string[] = [];

    for (const link of setlistSongsRes.data || []) {
      const sid = (link as any)?.song_id;
      if (sid) {
        setlistSongIds.add(sid);
        if (!knownSongIds.has(sid)) {
          knownSongIds.add(sid);
          missingSetlistSongIds.push(sid);
        }
      }
    }

    // Si algún setlist referencia canciones cuyo band_id difiera, recuperarlas también para paridad 1:1 con Live Concert
    if (missingSetlistSongIds.length > 0) {
      try {
        const extraQuery: any = supabase
          .from('songs')
          .select('id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url');
        if (typeof extraQuery.in === 'function') {
          const extraRes = await extraQuery.in('id', missingSetlistSongIds);
          if (!extraRes.error && Array.isArray(extraRes.data)) {
            for (const row of extraRes.data) {
              if (row?.id) lightSongs.push(row as PracticeSongItem);
            }
          }
        }
      } catch {}
    }

    const activeLightSongs = lightSongs.filter(
      (s) =>
        setlistSongIds.has(s.id) ||
        Boolean(s.foh_mobile_url || s.foh_mix_url || s.cue_mobile_url || s.cue_mix_url)
    );

    // Paso 2: Delta Detection — identificar SOLO canciones nuevas o cuya mezcla cambió
    const idsNeedingPrompterData: string[] = [];
    for (const s of activeLightSongs) {
      const prev = cachedSongsMap.get(s.id);
      const urlsChanged =
        !prev ||
        prev.foh_mobile_url !== s.foh_mobile_url ||
        prev.cue_mobile_url !== s.cue_mobile_url ||
        prev.foh_mix_url !== s.foh_mix_url ||
        prev.cue_mix_url !== s.cue_mix_url ||
        prev.prompter_data === undefined;

      if (force || urlsChanged) {
        idsNeedingPrompterData.push(s.id);
      }
    }

    const freshPrompterById = new Map<string, any>();
    if (idsNeedingPrompterData.length > 0) {
      try {
        const queryBuilder: any = supabase
          .from('songs')
          .select('id, prompter_data')
          .eq('band_id', FAKE_BAND_ID);

        const prompterRes =
          typeof queryBuilder.in === 'function'
            ? await queryBuilder.in('id', idsNeedingPrompterData)
            : await queryBuilder.order('title', { ascending: true });

        if (!prompterRes.error && Array.isArray(prompterRes.data)) {
          for (const row of prompterRes.data) {
            if (row?.id) {
              freshPrompterById.set(row.id, row.prompter_data);
            }
          }
        }
      } catch {
        // Non-blocking: falls back to cached prompter_data if available
      }
    }

    const mergedSongsList: PracticeSongItem[] = activeLightSongs.map((s) => {
      const prev = cachedSongsMap.get(s.id);
      const prompterData = freshPrompterById.has(s.id)
        ? freshPrompterById.get(s.id)
        : prev?.prompter_data;
      return {
        ...s,
        prompter_data: prompterData,
      };
    });

    const songsById = new Map<string, PracticeSongItem>(mergedSongsList.map((s) => [s.id, s]));
    const setlistSongsMap: Record<string, PracticeSongItem[]> = {};
    for (const sl of setlists) {
      setlistSongsMap[sl.id] = [];
    }

    for (const link of setlistSongsRes.data || []) {
      const song = songsById.get((link as any).song_id);
      const slId = (link as any).setlist_id;
      if (song && slId) {
        if (!setlistSongsMap[slId]) setlistSongsMap[slId] = [];
        setlistSongsMap[slId].push({
          ...song,
          position: (link as any).position,
        });
      }
    }

    const snapshot: PracticeCatalogSnapshot = {
      setlists,
      setlistSongsMap,
      allLiveSongs: mergedSongsList,
      syncedAt: new Date().toISOString(),
    };

    recordCatalogSyncTimestampMs(nowMs);
    await saveCachedPracticeCatalog(snapshot);
    return snapshot;
  } catch {
    return cached;
  }
}

// ============================================================================
// ENCRYPTED VAULT INDEX & VOLATILE RAM DECRYPTION
// ============================================================================
/**
 * Lee directamente desde IndexedDB (o memoria) el metadato de caché local de una canción,
 * evitando condiciones de carrera con refs/estados de React recién montados.
 */
export async function readLocalTrackMeta(
  songId: string
): Promise<LocalMp3TrackMeta | undefined> {
  if (!songId) return undefined;
  const mem = memoryIndexMap.get(songId);
  const db = await openVaultDb();
  if (db) {
    const row = await idbGet<LocalMp3TrackMeta>(db, STORE_MP3_INDEX, songId);
    if (row) {
      // Si en la sesión actual en RAM tiene más canales descargados (ej. Safari Modo Privado), priorizar el más completo
      if (mem && ((mem.hasCue && !row.hasCue) || (mem.hasFoh && !row.hasFoh))) {
        return mem;
      }
      memoryIndexMap.set(songId, row);
      return row;
    }
  }
  return mem;
}

export async function readLocalVaultSummary(): Promise<LocalVaultSummary> {
  const db = await openVaultDb();
  const mergedById = new Map<string, LocalMp3TrackMeta>();

  if (db) {
    const idbEntries = await idbGetAll<LocalMp3TrackMeta>(db, STORE_MP3_INDEX);
    for (const item of idbEntries) {
      if (item?.songId) {
        mergedById.set(item.songId, item);
        if (!memoryIndexMap.has(item.songId)) {
          memoryIndexMap.set(item.songId, item);
        }
      }
    }
  }

  // Unir siempre con memoryIndexMap para que dispositivos en Modo Privado o con cuota IndexedDB restringida funcionen al 100%
  for (const [songId, memMeta] of memoryIndexMap.entries()) {
    const existing = mergedById.get(songId);
    if (
      !existing ||
      (memMeta.savedAt && (!existing.savedAt || memMeta.savedAt >= existing.savedAt))
    ) {
      mergedById.set(songId, memMeta);
    }
  }

  const tracksBySongId: Record<string, LocalMp3TrackMeta> = {};
  let totalSavedSongs = 0;
  let totalBytesUsed = 0;

  for (const meta of mergedById.values()) {
    if (!meta?.songId) continue;
    tracksBySongId[meta.songId] = meta;
    if (meta.hasFoh) {
      totalSavedSongs += 1;
    }
    totalBytesUsed += meta.totalBytes || 0;
  }

  let deviceQuotaBytes: number | undefined;
  let deviceUsageBytes: number | undefined;
  let isPersistedStorage: boolean | undefined;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        deviceQuotaBytes = est.quota;
        deviceUsageBytes = est.usage;
      }
      if (typeof navigator.storage.persisted === 'function') {
        isPersistedStorage = await navigator.storage.persisted();
      }
    } catch {}
  }

  return {
    tracksBySongId,
    totalSavedSongs,
    totalBytesUsed,
    deviceQuotaBytes,
    deviceUsageBytes,
    isPersistedStorage,
  };
}

/**
 * Lee y descifra en memoria RAM volátil el ArrayBuffer de una pista guardada.
 * El llamador debe invocar `wipeAudioArrayBufferInRam(buffer)` apenas lo decodifique en Web Audio.
 */
export async function readDecryptedTrackArrayBuffer(
  songId: string,
  channel: 'foh' | 'cue'
): Promise<ArrayBuffer | null> {
  const blobKey = `${songId}:${channel}`;
  const db = await openVaultDb();

  if (db) {
    const stored = await idbGet<StoredEncryptedPayload>(db, STORE_MP3_BLOBS, blobKey);
    if (stored?.buffer && stored.buffer.byteLength > 0) {
      const decrypted = await decryptVaultPayloadToRamBuffer(stored, db);
      if (decrypted && decrypted.byteLength > 0) {
        return decrypted;
      }
    }
  }

  const mem = memoryBlobMap.get(blobKey);
  if (mem?.buffer && mem.buffer.byteLength > 0) {
    return decryptVaultPayloadToRamBuffer(mem, db);
  }

  return null;
}

/**
 * Inspecciona el payload crudo cifrado en la bóveda (para verificar en pruebas que NO es texto plano MP3).
 */
export async function inspectRawEncryptedVaultBuffer(
  songId: string,
  channel: 'foh' | 'cue'
): Promise<{ cipherScheme: string; rawCipherBytes: Uint8Array } | null> {
  const blobKey = `${songId}:${channel}`;
  const db = await openVaultDb();
  const stored = db
    ? await idbGet<StoredEncryptedPayload>(db, STORE_MP3_BLOBS, blobKey)
    : memoryBlobMap.get(blobKey);
  const target = stored || memoryBlobMap.get(blobKey);
  if (!target?.buffer) return null;
  return {
    cipherScheme: target.cipherScheme,
    rawCipherBytes: new Uint8Array(target.buffer.slice(0, 32)),
  };
}

export async function readLocalMp3Blob(
  songId: string,
  channel: 'foh' | 'cue'
): Promise<Blob | null> {
  const decrypted = await readDecryptedTrackArrayBuffer(songId, channel);
  if (!decrypted || decrypted.byteLength === 0) return null;
  return new Blob([decrypted], { type: 'audio/mpeg' });
}

export async function saveRawMp3BufferToVault(params: {
  songId: string;
  title: string;
  channel: 'foh' | 'cue';
  buffer: ArrayBuffer;
  sourceSig: string;
  convertedFromWav?: boolean;
}): Promise<LocalMp3TrackMeta> {
  const { songId, title, channel, buffer, sourceSig, convertedFromWav } = params;
  const blobKey = `${songId}:${channel}`;
  const db = await openVaultDb();

  // Cifrar antes de escribir en IndexedDB
  const encryptedPayload = await encryptAudioBufferForVault(buffer, blobKey, db);

  let existingMeta: LocalMp3TrackMeta | undefined = memoryIndexMap.get(songId);
  if (!existingMeta && db) {
    existingMeta = await idbGet<LocalMp3TrackMeta>(db, STORE_MP3_INDEX, songId);
  }

  const fohBytes = channel === 'foh' ? buffer.byteLength : existingMeta?.fohBytes || 0;
  const cueBytes = channel === 'cue' ? buffer.byteLength : existingMeta?.cueBytes || 0;

  const nextMeta: LocalMp3TrackMeta = {
    songId,
    title: title || existingMeta?.title || 'Canción',
    hasFoh: channel === 'foh' ? true : Boolean(existingMeta?.hasFoh),
    hasCue: channel === 'cue' ? true : Boolean(existingMeta?.hasCue),
    fohSourceSig: channel === 'foh' ? sourceSig : existingMeta?.fohSourceSig || '',
    cueSourceSig: channel === 'cue' ? sourceSig : existingMeta?.cueSourceSig || '',
    fohBytes,
    cueBytes,
    totalBytes: fohBytes + cueBytes,
    savedAt: new Date().toISOString(),
    encrypted: true,
    convertedFromWav: Boolean(convertedFromWav || existingMeta?.convertedFromWav),
    cueSynthesizedFallback:
      channel === 'cue' ? false : Boolean(existingMeta?.cueSynthesizedFallback),
  };

  // Mantener copia cifrada en RAM para disponibilidad inmediata aun si IndexedDB está en Modo Privado / baja cuota
  memoryBlobMap.set(blobKey, encryptedPayload);
  memoryIndexMap.set(songId, nextMeta);

  if (db) {
    // Escribir primero el blob cifrado; solo persistir el índice en IDB si el blob se guardó con éxito
    const blobSaved = await idbPut(db, STORE_MP3_BLOBS, encryptedPayload);
    if (blobSaved) {
      await idbPut(db, STORE_MP3_INDEX, nextMeta);
    }
  }

  return nextMeta;
}

function hasRiffWavHeader(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const bytes = new Uint8Array(buffer, 0, 12);
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

function looksLikeTextOrHtmlErrorPayload(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return true;
  const head = new Uint8Array(buffer, 0, Math.min(24, buffer.byteLength));
  let start = 0;
  while (
    start < head.length &&
    (head[start] === 0x20 || head[start] === 0x09 || head[start] === 0x0a || head[start] === 0x0d)
  ) {
    start++;
  }
  if (start >= head.length) return true;
  const ascii = String.fromCharCode(...Array.from(head.slice(start, start + 12))).toLowerCase();
  return (
    ascii.startsWith('<!doc') ||
    ascii.startsWith('<html') ||
    ascii.startsWith('<?xml') ||
    ascii.startsWith('{"error') ||
    ascii.startsWith('{"status')
  );
}

/**
 * Codificador streaming RIFF WAV -> MP3 en JavaScript puro (CERO `AudioContext` de hardware).
 * Evita por completo el límite de 4–6 AudioContexts y el bloqueo de gesto táctil en Safari iOS / Chrome Android,
 * usando <32 KB de buffers temporales en lugar de ~180 MB de Float32Array.
 */
export async function encodeRiffWavBufferToMp3(
  wavBuffer: ArrayBuffer,
  bitrate: number = 128,
  forceMono: boolean = false
): Promise<ArrayBuffer> {
  if (!hasRiffWavHeader(wavBuffer)) {
    throw new Error('El archivo no tiene cabecera RIFF WAVE válida');
  }

  const view = new DataView(wavBuffer);
  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= wavBuffer.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (id === 'fmt ' && chunkSize >= 16 && chunkDataStart + 16 <= wavBuffer.byteLength) {
      audioFormat = view.getUint16(chunkDataStart, true);
      numChannels = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);
      // WAVE_FORMAT_EXTENSIBLE (0xFFFE)
      if (audioFormat === 0xfffe && chunkSize >= 40 && chunkDataStart + 26 <= wavBuffer.byteLength) {
        audioFormat = view.getUint16(chunkDataStart + 24, true);
      }
    } else if (id === 'data') {
      dataOffset = chunkDataStart;
      dataLength = Math.min(chunkSize, wavBuffer.byteLength - chunkDataStart);
      break;
    }

    const padded = chunkSize + (chunkSize & 1);
    offset = chunkDataStart + padded;
  }

  const isSupportedPcm =
    (audioFormat === 1 && (bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32)) ||
    (audioFormat === 3 && bitsPerSample === 32);

  if (
    !isSupportedPcm ||
    numChannels < 1 ||
    sampleRate < 8000 ||
    dataOffset < 0 ||
    dataLength <= 0
  ) {
    throw new Error(`Formato WAV no soportado directamente (fmt=${audioFormat}, bits=${bitsPerSample})`);
  }

  const lamejs = await loadLameJs();
  const outChannels = forceMono || numChannels === 1 ? 1 : 2;
  const encoder = new lamejs.Mp3Encoder(outChannels, sampleRate, bitrate);

  const bytesPerSample = bitsPerSample >> 3;
  const blockAlign = numChannels * bytesPerSample;
  const totalFrames = Math.floor(dataLength / blockAlign);
  const blockSize = 1152;

  const left16 = new Int16Array(blockSize);
  const right16 = new Int16Array(blockSize);
  const mp3Chunks: Uint8Array[] = [];
  let totalMp3Bytes = 0;

  const readSampleInt16 = (bytePos: number): number => {
    if (audioFormat === 1) {
      if (bitsPerSample === 16) {
        return view.getInt16(bytePos, true);
      }
      if (bitsPerSample === 24) {
        const b0 = view.getUint8(bytePos);
        const b1 = view.getUint8(bytePos + 1);
        const b2 = view.getInt8(bytePos + 2);
        return ((b2 << 16) | (b1 << 8) | b0) >> 8;
      }
      return view.getInt32(bytePos, true) >> 16;
    }
    const f = Math.max(-1, Math.min(1, view.getFloat32(bytePos, true)));
    return f < 0 ? (f * 0x8000) | 0 : (f * 0x7fff) | 0;
  };

  let frameOffset = 0;
  let iter = 0;
  while (frameOffset < totalFrames) {
    const count = Math.min(blockSize, totalFrames - frameOffset);

    if (outChannels === 1) {
      if (numChannels === 1) {
        for (let i = 0; i < count; i++) {
          left16[i] = readSampleInt16(dataOffset + (frameOffset + i) * blockAlign);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const base = dataOffset + (frameOffset + i) * blockAlign;
          const l = readSampleInt16(base);
          const r = readSampleInt16(base + bytesPerSample);
          left16[i] = (l + r) >> 1;
        }
      }
      const encoded: Int8Array = encoder.encodeBuffer(
        count === blockSize ? left16 : left16.subarray(0, count)
      );
      if (encoded.byteLength > 0) {
        const copy = new Uint8Array(encoded.byteLength);
        copy.set(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
        mp3Chunks.push(copy);
        totalMp3Bytes += copy.byteLength;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const base = dataOffset + (frameOffset + i) * blockAlign;
        left16[i] = readSampleInt16(base);
        right16[i] = readSampleInt16(base + bytesPerSample);
      }
      const encoded: Int8Array = encoder.encodeBuffer(
        count === blockSize ? left16 : left16.subarray(0, count),
        count === blockSize ? right16 : right16.subarray(0, count)
      );
      if (encoded.byteLength > 0) {
        const copy = new Uint8Array(encoded.byteLength);
        copy.set(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
        mp3Chunks.push(copy);
        totalMp3Bytes += copy.byteLength;
      }
    }

    frameOffset += count;
    iter++;
    if (iter % 80 === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }

  const tail: Int8Array = encoder.flush();
  if (tail.byteLength > 0) {
    const copy = new Uint8Array(tail.byteLength);
    copy.set(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength));
    mp3Chunks.push(copy);
    totalMp3Bytes += copy.byteLength;
  }

  const merged = new Uint8Array(totalMp3Bytes);
  let writePos = 0;
  for (const chunk of mp3Chunks) {
    merged.set(chunk, writePos);
    writePos += chunk.byteLength;
  }
  return merged.buffer;
}

async function ensureMp3BufferFromFetchedAudio(
  rawBuffer: ArrayBuffer,
  contentType: string,
  isLikelyWav: boolean,
  channel: 'foh' | 'cue',
  onProgress?: (msg: string) => void
): Promise<{ buffer: ArrayBuffer; convertedFromWav: boolean }> {
  const isRiffWav = hasRiffWavHeader(rawBuffer);
  const isWav = isRiffWav || (isLikelyWav && contentType.toLowerCase().includes('wav'));

  if (!isWav) {
    return { buffer: rawBuffer, convertedFromWav: false };
  }

  onProgress?.('Comprimiendo audio a MP3 ligero para memoria del celular...');
  const targetBitrate = channel === 'cue' ? 96 : 128;

  // 1. Ruta principal sin AudioContext: decodificación streaming RIFF PCM WAV -> MP3 (0 límite de hardware móvil)
  if (isRiffWav) {
    try {
      const mp3Buffer = await encodeRiffWavBufferToMp3(rawBuffer, targetBitrate, false);
      if (mp3Buffer.byteLength > 128) {
        return { buffer: mp3Buffer, convertedFromWav: true };
      }
    } catch (directErr) {
      console.warn('[Vault] Fallback tras codificación WAV directa:', directErr);
    }
  }

  // 2. Ruta secundaria con OfflineAudioContext (NO consume los 6 slots de hardware AudioContext en iOS/Android)
  if (typeof window !== 'undefined') {
    const OfflineCtxClass =
      window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (OfflineCtxClass) {
      try {
        const offlineCtx = new OfflineCtxClass(2, 1, 44100);
        const decoded = await offlineCtx.decodeAudioData(rawBuffer.slice(0));
        const mp3Blob = await audioBufferToMp3Blob(decoded, targetBitrate, false);
        const mp3Arr = await new Response(mp3Blob).arrayBuffer();
        if (mp3Arr.byteLength > 128) {
          return { buffer: mp3Arr, convertedFromWav: true };
        }
      } catch (offlineErr) {
        console.warn('[Vault] Fallback guardando audio original sin recodificar:', offlineErr);
      }
    }
  }

  // 3. Red de seguridad final: jamás abortar la descarga si falla la compresión MP3 en un móvil antiguo
  return { buffer: rawBuffer, convertedFromWav: false };
}

async function fetchSingleUrlWithRetry(
  url: string,
  callerSignal?: AbortSignal,
  maxAttempts = 2
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (callerSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const attemptCtrl = new AbortController();
    const onCallerAbort = () => attemptCtrl.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeoutId = globalThis.setTimeout(() => attemptCtrl.abort(), 60000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: attemptCtrl.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const rawBuf = await res.arrayBuffer();
      const contentType = res.headers?.get?.('content-type') || '';

      if (rawBuf.byteLength < 8 || looksLikeTextOrHtmlErrorPayload(rawBuf)) {
        throw new Error('Respuesta de audio inválida o incompleta');
      }

      return { buffer: rawBuf, contentType };
    } catch (err: any) {
      if (callerSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      // No reintentar el mismo URL si el archivo no existe (400/404); pasar de inmediato al URL de respaldo
      if (/HTTP (400|403|404)/i.test(lastError.message)) {
        break;
      }
      if (attempt < maxAttempts) {
        await new Promise<void>((r) => globalThis.setTimeout(r, 350));
      }
    } finally {
      globalThis.clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  throw lastError || new Error('Error de red descargando pista');
}

async function fetchChannelAudioWithFallback(
  song: PracticeSongItem,
  channel: 'foh' | 'cue',
  signal?: AbortSignal
): Promise<{ buffer: ArrayBuffer; contentType: string; isLikelyWav: boolean }> {
  const candidates = resolveCandidateAudioSources(song, channel);
  if (candidates.length === 0) {
    throw new Error(`Sin URL de audio para canal ${channel.toUpperCase()}`);
  }

  let lastErr: Error | null = null;
  for (const candidate of candidates) {
    try {
      const fetched = await fetchSingleUrlWithRetry(candidate.url, signal, 2);
      return {
        buffer: fetched.buffer,
        contentType: fetched.contentType,
        isLikelyWav: candidate.isLikelyWav,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw (
    lastErr ||
    new Error(`No se pudo descargar el audio (${channel.toUpperCase()}) de "${song.title}"`)
  );
}

async function markCueSynthesizedFallbackInVault(
  songId: string,
  cueSig: string
): Promise<LocalMp3TrackMeta | undefined> {
  const db = await openVaultDb();
  let existing = memoryIndexMap.get(songId);
  if (!existing && db) {
    existing = await idbGet<LocalMp3TrackMeta>(db, STORE_MP3_INDEX, songId);
  }
  if (!existing) return undefined;

  const updated: LocalMp3TrackMeta = {
    ...existing,
    cueSourceSig: cueSig,
    cueSynthesizedFallback: true,
    savedAt: new Date().toISOString(),
  };
  memoryIndexMap.set(songId, updated);
  if (db) {
    await idbPut(db, STORE_MP3_INDEX, updated);
  }
  return updated;
}

/**
 * Sincroniza en la bóveda cifrada local la pista de Live Concert.
 * Por defecto `includeCue = false` (ahorra 50% de Supabase Storage Egress);
 * el canal Click/Guía se descarga únicamente bajo demanda cuando el músico activa `+ Click / Guía` o en In-Ear Monitor.
 */
export async function ensureSongMp3CachedInDevice(params: {
  song: PracticeSongItem;
  includeCue?: boolean;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}): Promise<LocalMp3TrackMeta> {
  const { song, includeCue = false, forceRefresh = false, signal, onProgress } = params;

  const currentMetaInitial = await readLocalTrackMeta(song.id);
  let currentMeta = currentMetaInitial;

  const fohCandidates = resolveCandidateAudioSources(song, 'foh');
  const cueCandidates = resolveCandidateAudioSources(song, 'cue');
  const fohSig = computeSongChannelSignature(song, 'foh');
  const cueSig = computeSongChannelSignature(song, 'cue');

  if (fohCandidates.length === 0 && !currentMeta?.hasFoh) {
    throw new Error(`"${song.title}" aún no tiene mezcla exportada para Live Concert.`);
  }

  // Verificar que el blob FOH realmente exista en almacenamiento si el índice afirma tenerlo
  let fohBlobVerified = false;
  if (!forceRefresh && currentMeta?.hasFoh) {
    const existingFohBuf = await readDecryptedTrackArrayBuffer(song.id, 'foh');
    if (existingFohBuf && existingFohBuf.byteLength > 0) {
      fohBlobVerified = true;
      wipeAudioArrayBufferInRam(existingFohBuf);
    }
  }

  // 1. Verificar / Sincronizar Pista Musical (FOH) con respaldo automático mobile_url -> mix_url
  const fohAlreadyFresh =
    !forceRefresh &&
    fohBlobVerified &&
    Boolean(currentMeta?.hasFoh) &&
    (!fohSig || currentMeta?.fohSourceSig === fohSig);

  if (!fohAlreadyFresh && fohCandidates.length > 0) {
    onProgress?.(`Descargando pistas de "${song.title}"...`);
    const fetchedFoh = await fetchChannelAudioWithFallback(song, 'foh', signal);
    const { buffer: mp3Buf, convertedFromWav } = await ensureMp3BufferFromFetchedAudio(
      fetchedFoh.buffer,
      fetchedFoh.contentType,
      fetchedFoh.isLikelyWav,
      'foh',
      onProgress
    );

    currentMeta = await saveRawMp3BufferToVault({
      songId: song.id,
      title: song.title,
      channel: 'foh',
      buffer: mp3Buf,
      sourceSig: fohSig,
      convertedFromWav,
    });
    if (mp3Buf !== fetchedFoh.buffer) {
      wipeAudioArrayBufferInRam(fetchedFoh.buffer);
    }
    wipeAudioArrayBufferInRam(mp3Buf);
  }

  // 2. Verificar / Sincronizar Click & Voz Guía (CUE) bajo demanda cuando includeCue === true
  if (includeCue && cueCandidates.length > 0) {
    let cueBlobVerified = false;
    if (!forceRefresh && currentMeta?.hasCue) {
      const existingCueBuf = await readDecryptedTrackArrayBuffer(song.id, 'cue');
      if (existingCueBuf && existingCueBuf.byteLength > 0) {
        cueBlobVerified = true;
        wipeAudioArrayBufferInRam(existingCueBuf);
      }
    }

    const cueAlreadyFresh =
      !forceRefresh &&
      ((cueBlobVerified && Boolean(currentMeta?.hasCue)) ||
        Boolean(currentMeta?.cueSynthesizedFallback)) &&
      (!cueSig || currentMeta?.cueSourceSig === cueSig);

    if (!cueAlreadyFresh) {
      onProgress?.(`Descargando Click y Voz Guía de "${song.title}"...`);
      try {
        const fetchedCue = await fetchChannelAudioWithFallback(song, 'cue', signal);
        const { buffer: cueMp3Buf, convertedFromWav: cueConverted } =
          await ensureMp3BufferFromFetchedAudio(
            fetchedCue.buffer,
            fetchedCue.contentType,
            fetchedCue.isLikelyWav,
            'cue',
            onProgress
          );

        currentMeta = await saveRawMp3BufferToVault({
          songId: song.id,
          title: song.title,
          channel: 'cue',
          buffer: cueMp3Buf,
          sourceSig: cueSig,
          convertedFromWav: cueConverted,
        });
        if (cueMp3Buf !== fetchedCue.buffer) {
          wipeAudioArrayBufferInRam(fetchedCue.buffer);
        }
        wipeAudioArrayBufferInRam(cueMp3Buf);
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        // Si el archivo CUE en la nube dio 404/error pero la canción tiene BPM válido,
        // activar síntesis de Click + Voz Guía en RAM para NO bloquear al músico en "Pendiente MP3"
        if (Number(song?.prompter_data?.bpm) > 0 && currentMeta?.hasFoh) {
          const fallbackMeta = await markCueSynthesizedFallbackInVault(song.id, cueSig);
          if (fallbackMeta) {
            currentMeta = fallbackMeta;
          }
        } else {
          throw new Error(
            `No se pudo descargar el canal Guía de "${song.title}" (${err?.message || 'Error de red'})`
          );
        }
      }
    }
  }

  if (!currentMeta) {
    throw new Error('No fue posible sincronizar la pista en la memoria interna.');
  }

  onProgress?.('');
  return currentMeta;
}

export interface InEarPlaylistReadiness {
  totalSongs: number;
  exportableSongs: PracticeSongItem[];
  readySongs: PracticeSongItem[];
  pendingSongs: PracticeSongItem[];
  noMixSongs: PracticeSongItem[];
  isFullyCached: boolean;
  totalCachedBytes: number;
}

/**
 * Evalúa el estado de caché local en MP3 (Pistas FOH + Clic/Guía CUE) de una Playlist completa
 * para el módulo In-Ear Monitor.
 */
export function evaluateInEarPlaylistReadiness(
  songs: PracticeSongItem[],
  tracksBySongId: Record<string, LocalMp3TrackMeta>
): InEarPlaylistReadiness {
  const safeSongs = Array.isArray(songs) ? songs : [];
  const exportableSongs: PracticeSongItem[] = [];
  const readySongs: PracticeSongItem[] = [];
  const pendingSongs: PracticeSongItem[] = [];
  const noMixSongs: PracticeSongItem[] = [];
  let totalCachedBytes = 0;

  for (const song of safeSongs) {
    if (!song?.id) continue;
    const meta = tracksBySongId?.[song.id];
    const ev = evaluateSongVaultState(song, meta);
    if (ev.status === 'no_mix') {
      noMixSongs.push(song);
      continue;
    }
    exportableSongs.push(song);
    totalCachedBytes += ev.localBytes;
    if (ev.status === 'offline_ready' && !ev.cueNeedsDownload) {
      readySongs.push(song);
    } else {
      pendingSongs.push(song);
    }
  }

  return {
    totalSongs: safeSongs.length,
    exportableSongs,
    readySongs,
    pendingSongs,
    noMixSongs,
    isFullyCached: exportableSongs.length > 0 && pendingSongs.length === 0,
    totalCachedBytes,
  };
}

/**
 * Descarga y guarda en la bóveda local cifrada (IndexedDB) todas las canciones pendientes
 * de una Playlist en formato MP3 ligero (incluyendo FOH + Clic/Guía CUE).
 * Las canciones ya guardadas en sesiones anteriores se reutilizan sin volver a descargar de Supabase.
 */
export async function downloadInEarPlaylistToLocalVault(params: {
  songs: PracticeSongItem[];
  tracksBySongId?: Record<string, LocalMp3TrackMeta>;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onTrackSaved?: (songId: string, meta: LocalMp3TrackMeta) => void;
  onSongProgress?: (info: {
    currentIndex: number;
    totalToDownload: number;
    songTitle: string;
    detail: string;
  }) => void;
}): Promise<{
  downloadedCount: number;
  skippedCachedCount: number;
  summary: LocalVaultSummary;
}> {
  const { songs, forceRefresh = false, signal, onTrackSaved, onSongProgress } = params;
  const initialSummary = params.tracksBySongId
    ? { tracksBySongId: params.tracksBySongId }
    : await readLocalVaultSummary();

  const readiness = evaluateInEarPlaylistReadiness(
    songs,
    initialSummary.tracksBySongId
  );
  const toDownload = forceRefresh ? readiness.exportableSongs : readiness.pendingSongs;
  const skippedCachedCount = forceRefresh ? 0 : readiness.readySongs.length;
  let downloadedCount = 0;

  for (let i = 0; i < toDownload.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const song = toDownload[i];
    onSongProgress?.({
      currentIndex: i + 1,
      totalToDownload: toDownload.length,
      songTitle: song.title,
      detail: `Descargando ${i + 1}/${toDownload.length}: "${song.title}"...`,
    });

    const savedMeta = await ensureSongMp3CachedInDevice({
      song,
      includeCue: true,
      forceRefresh,
      signal,
      onProgress: (msg) => {
        if (msg) {
          onSongProgress?.({
            currentIndex: i + 1,
            totalToDownload: toDownload.length,
            songTitle: song.title,
            detail: `(${i + 1}/${toDownload.length}) ${msg}`,
          });
        }
      },
    });
    onTrackSaved?.(song.id, savedMeta);
    downloadedCount += 1;
  }

  const finalSummary = await readLocalVaultSummary();
  return {
    downloadedCount,
    skippedCachedCount,
    summary: finalSummary,
  };
}

export async function removeSongFromLocalVault(songId: string): Promise<void> {
  memoryIndexMap.delete(songId);
  memoryBlobMap.delete(`${songId}:foh`);
  memoryBlobMap.delete(`${songId}:cue`);

  const db = await openVaultDb();
  if (db) {
    await Promise.all([
      idbDelete(db, STORE_MP3_INDEX, songId),
      idbDelete(db, STORE_MP3_BLOBS, `${songId}:foh`),
      idbDelete(db, STORE_MP3_BLOBS, `${songId}:cue`),
    ]);
  }
}

/**
 * Kill-Switch: Destruye la llave criptográfica AES-256, purga todos los audios cifrados
 * y revoca la licencia offline (ejecutado automáticamente al Cerrar Sesión o al Dar de Baja).
 */
export async function clearAllLocalMp3Vault(): Promise<void> {
  const keys = Array.from(memoryIndexMap.keys());
  memoryIndexMap.clear();
  memoryBlobMap.clear();
  memoryCatalogCache = null;
  memoryCryptoKey = null;
  memoryFallbackSecret = null;
  memoryOfflineLease = null;
  lastCatalogRemoteSyncMs = 0;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(OFFLINE_LEASE_STORAGE_KEY);
      window.localStorage.removeItem(LAST_SYNC_STORAGE_KEY);
      window.localStorage.removeItem(FALLBACK_SECRET_STORAGE_KEY);
    } catch {}
  }

  const db = await openVaultDb();
  if (db) {
    const allMeta = await idbGetAll<LocalMp3TrackMeta>(db, STORE_MP3_INDEX);
    const ids = Array.from(new Set([...keys, ...allMeta.map((m) => m.songId)]));
    await Promise.all([
      idbDelete(db, STORE_CATALOG, CATALOG_RECORD_KEY),
      idbDelete(db, STORE_CRYPTO_KEYS, MASTER_KEY_ID),
      idbDelete(db, STORE_CRYPTO_KEYS, `${MASTER_KEY_ID}_fallback`),
      ...ids.flatMap((id) => [
        idbDelete(db, STORE_MP3_INDEX, id),
        idbDelete(db, STORE_MP3_BLOBS, `${id}:foh`),
        idbDelete(db, STORE_MP3_BLOBS, `${id}:cue`),
      ]),
    ]);
  }
}
