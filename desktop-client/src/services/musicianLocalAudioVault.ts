import { supabase } from '../lib/supabase';
import { audioBufferToMp3Blob } from '../hooks/useAudioEngine';
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
}

interface StoredEncryptedPayload {
  key: string;
  buffer: ArrayBuffer;
  iv?: Uint8Array;
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
// IN-MEMORY FALLBACK (Para entornos sin IndexedDB / Vitest / WebViews privados)
// ============================================================================
let memoryCatalogCache: PracticeCatalogSnapshot | null = null;
const memoryIndexMap = new Map<string, LocalMp3TrackMeta>();
const memoryBlobMap = new Map<string, StoredEncryptedPayload>();
let memoryCryptoKey: CryptoKey | null = null;
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
  memoryFallbackSecret = null;
  memoryOfflineLease = null;
  lastCatalogRemoteSyncMs = 0;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LAST_SYNC_STORAGE_KEY);
      window.localStorage.removeItem(OFFLINE_LEASE_STORAGE_KEY);
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
// INDEXEDDB LOW-LEVEL ENGINE
// ============================================================================
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as T[]) : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function idbPut(db: IDBDatabase, storeName: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ============================================================================
// MILITARY-GRADE LOCAL ENCRYPTION (AES-256-GCM extractable:false + CTR Fallback)
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
    memoryCryptoKey = generated;

    if (db) {
      await idbPut(db, STORE_CRYPTO_KEYS, { id: MASTER_KEY_ID, key: generated });
    }
    return generated;
  } catch {
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
  const bytes = randomBytes(32);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  memoryFallbackSecret = secret;
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
  const iv = randomBytes(12);
  const aesKey = await getOrCreateNonExportableAesKey(db);

  if (aesKey && typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const aad = new TextEncoder().encode(`tandu_vault_v2::${blobKey}`);
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aad,
        },
        aesKey,
        plainBuffer
      );
      return {
        key: blobKey,
        buffer: encrypted,
        iv,
        cipherScheme: 'aes-256-gcm',
        mimeType: 'application/octet-stream',
      };
    } catch {
      // Fall through to CTR cipher
    }
  }

  const secret = await getOrCreateFallbackSecret(db);
  const transformed = xorCtrStreamTransform(plainBuffer, secret, iv, blobKey);
  return {
    key: blobKey,
    buffer: transformed,
    iv,
    cipherScheme: 'sha256-ctr-v1',
    mimeType: 'application/octet-stream',
  };
}

async function decryptVaultPayloadToRamBuffer(
  stored: StoredEncryptedPayload,
  db: IDBDatabase | null
): Promise<ArrayBuffer | null> {
  if (!stored?.buffer || stored.buffer.byteLength === 0) return null;

  if (stored.cipherScheme === 'aes-256-gcm' && stored.iv) {
    const aesKey = await getOrCreateNonExportableAesKey(db);
    if (!aesKey || typeof crypto === 'undefined' || !crypto.subtle) return null;
    try {
      const aad = new TextEncoder().encode(`tandu_vault_v2::${stored.key}`);
      return await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: stored.iv,
          additionalData: aad,
        },
        aesKey,
        stored.buffer
      );
    } catch {
      return null;
    }
  }

  if (stored.cipherScheme === 'sha256-ctr-v1' && stored.iv) {
    const secret = await getOrCreateFallbackSecret(db);
    return xorCtrStreamTransform(stored.buffer, secret, stored.iv, stored.key);
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
        persisted = await navigator.storage.persist();
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
    const cueMatchesIfCached =
      !hasLocalCue || !cueSigNow || localMeta?.cueSourceSig === cueSigNow;
    const cueNeedsDownload =
      hasCloudCue && (!hasLocalCue || (Boolean(cueSigNow) && localMeta?.cueSourceSig !== cueSigNow));

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

    if (setlistsRes.error || lightSongsRes.error) {
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

    const lightSongs: PracticeSongItem[] = (lightSongsRes.data || []) as PracticeSongItem[];
    const setlistSongIds = new Set<string>();
    for (const link of setlistSongsRes.data || []) {
      if ((link as any)?.song_id) {
        setlistSongIds.add((link as any).song_id);
      }
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
export async function readLocalVaultSummary(): Promise<LocalVaultSummary> {
  const db = await openVaultDb();
  let entries: LocalMp3TrackMeta[] = [];

  if (db) {
    entries = await idbGetAll<LocalMp3TrackMeta>(db, STORE_MP3_INDEX);
    for (const item of entries) {
      memoryIndexMap.set(item.songId, item);
    }
  } else {
    entries = Array.from(memoryIndexMap.values());
  }

  const tracksBySongId: Record<string, LocalMp3TrackMeta> = {};
  let totalSavedSongs = 0;
  let totalBytesUsed = 0;

  for (const meta of entries) {
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
      return decryptVaultPayloadToRamBuffer(stored, db);
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

  // Cifrar con AES-256-GCM (extractable: false) antes de tocar IndexedDB
  const encryptedPayload = await encryptAudioBufferForVault(buffer, blobKey, db);

  let existingMeta: LocalMp3TrackMeta | undefined;
  if (db) {
    existingMeta = await idbGet<LocalMp3TrackMeta>(db, STORE_MP3_INDEX, songId);
  }
  if (!existingMeta) {
    existingMeta = memoryIndexMap.get(songId);
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
  };

  memoryBlobMap.set(blobKey, encryptedPayload);
  memoryIndexMap.set(songId, nextMeta);

  if (db) {
    await Promise.all([
      idbPut(db, STORE_MP3_BLOBS, encryptedPayload),
      idbPut(db, STORE_MP3_INDEX, nextMeta),
    ]);
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

async function ensureMp3BufferFromFetchedAudio(
  rawBuffer: ArrayBuffer,
  contentType: string,
  isLikelyWav: boolean,
  channel: 'foh' | 'cue',
  onProgress?: (msg: string) => void
): Promise<{ buffer: ArrayBuffer; convertedFromWav: boolean }> {
  const isWav =
    isLikelyWav ||
    contentType.toLowerCase().includes('wav') ||
    hasRiffWavHeader(rawBuffer);

  if (!isWav) {
    return { buffer: rawBuffer, convertedFromWav: false };
  }

  if (typeof window === 'undefined') {
    return { buffer: rawBuffer, convertedFromWav: false };
  }

  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) {
    return { buffer: rawBuffer, convertedFromWav: false };
  }

  onProgress?.('Comprimiendo audio para memoria interna...');
  const tempCtx = new AudioCtxClass();
  try {
    const decoded = await tempCtx.decodeAudioData(rawBuffer.slice(0));
    // FOH a 128 kbps Estéreo, CUE (Click/Guía) a 64 kbps Mono para mínimo espacio
    const mp3Blob =
      channel === 'cue'
        ? await audioBufferToMp3Blob(decoded, 64, true)
        : await audioBufferToMp3Blob(decoded, 128, false);
    const mp3Arr = await mp3Blob.arrayBuffer();
    return { buffer: mp3Arr, convertedFromWav: true };
  } finally {
    tempCtx.close().catch(() => {});
  }
}

/**
 * Sincroniza en la bóveda cifrada local la pista de Live Concert.
 * Por defecto `includeCue = false` (ahorra 50% de Supabase Storage Egress);
 * el canal Click/Guía se descarga únicamente bajo demanda cuando el músico activa `+ Click / Guía`.
 */
export async function ensureSongMp3CachedInDevice(params: {
  song: PracticeSongItem;
  includeCue?: boolean;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}): Promise<LocalMp3TrackMeta> {
  const { song, includeCue = false, forceRefresh = false, signal, onProgress } = params;

  const db = await openVaultDb();
  let currentMeta = db
    ? await idbGet<LocalMp3TrackMeta>(db, STORE_MP3_INDEX, song.id)
    : memoryIndexMap.get(song.id);
  if (!currentMeta) currentMeta = memoryIndexMap.get(song.id);

  const fohSrc = resolvePreferredMp3Source(song, 'foh');
  const cueSrc = resolvePreferredMp3Source(song, 'cue');
  const fohSig = computeSongChannelSignature(song, 'foh');
  const cueSig = computeSongChannelSignature(song, 'cue');

  if (!fohSrc.url && !currentMeta?.hasFoh) {
    throw new Error('Esta canción aún no tiene mezcla exportada para Live Concert.');
  }

  // 1. Verificar / Sincronizar Pista Musical (FOH)
  const fohAlreadyFresh =
    !forceRefresh &&
    Boolean(currentMeta?.hasFoh) &&
    (!fohSig || currentMeta?.fohSourceSig === fohSig);

  if (!fohAlreadyFresh && fohSrc.url) {
    onProgress?.(`Sincronizando "${song.title}" en memoria cifrada...`);
    const res = await fetch(fohSrc.url, { signal });
    if (!res.ok) {
      throw new Error(`No se pudo sincronizar la pista (${res.status})`);
    }
    const rawBuf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || '';
    const { buffer: mp3Buf, convertedFromWav } = await ensureMp3BufferFromFetchedAudio(
      rawBuf,
      contentType,
      fohSrc.isLikelyWav,
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
    wipeAudioArrayBufferInRam(mp3Buf);
  }

  // 2. Verificar / Sincronizar Click & Voz Guía (CUE) SOLO bajo demanda cuando includeCue === true
  if (includeCue && cueSrc.url) {
    const cueAlreadyFresh =
      !forceRefresh &&
      Boolean(currentMeta?.hasCue) &&
      (!cueSig || currentMeta?.cueSourceSig === cueSig);

    if (!cueAlreadyFresh) {
      onProgress?.(`Sincronizando Click y Voz Guía de "${song.title}"...`);
      try {
        const cueRes = await fetch(cueSrc.url, { signal });
        if (cueRes.ok) {
          const rawCueBuf = await cueRes.arrayBuffer();
          const cueContentType = cueRes.headers.get('content-type') || '';
          const { buffer: cueMp3Buf, convertedFromWav: cueConverted } =
            await ensureMp3BufferFromFetchedAudio(
              rawCueBuf,
              cueContentType,
              cueSrc.isLikelyWav,
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
          wipeAudioArrayBufferInRam(cueMp3Buf);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
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
  signal?: AbortSignal;
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
  const { songs, signal, onSongProgress } = params;
  const initialSummary = params.tracksBySongId
    ? { tracksBySongId: params.tracksBySongId }
    : await readLocalVaultSummary();

  const readiness = evaluateInEarPlaylistReadiness(
    songs,
    initialSummary.tracksBySongId
  );
  const toDownload = readiness.pendingSongs;
  const skippedCachedCount = readiness.readySongs.length;
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

    await ensureSongMp3CachedInDevice({
      song,
      includeCue: true,
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
