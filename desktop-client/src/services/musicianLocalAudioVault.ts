import { supabase } from '../lib/supabase';
import { audioBufferToMp3Blob } from '../hooks/useAudioEngine';

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';

const DB_NAME = 'tandu_musician_mp3_vault_v1';
const DB_VERSION = 1;
const STORE_CATALOG = 'catalog';
const STORE_MP3_INDEX = 'mp3_index';
const STORE_MP3_BLOBS = 'mp3_blobs';
const CATALOG_RECORD_KEY = 'active_live_catalog';

// Evita consultas repetidas a Supabase al cambiar de vista durante la misma sesión (2 min)
const CATALOG_SYNC_COOLDOWN_MS = 120_000;

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
  convertedFromWav?: boolean;
}

interface StoredBinaryPayload {
  key: string;
  buffer: ArrayBuffer;
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

// ============================================================================
// IN-MEMORY FALLBACK (Para entornos sin IndexedDB / Vitest / WebViews privados)
// ============================================================================
let memoryCatalogCache: PracticeCatalogSnapshot | null = null;
const memoryIndexMap = new Map<string, LocalMp3TrackMeta>();
const memoryBlobMap = new Map<string, StoredBinaryPayload>();
let lastCatalogRemoteSyncMs = 0;

export function resetMusicianVaultMemoryForTests(): void {
  memoryCatalogCache = null;
  memoryIndexMap.clear();
  memoryBlobMap.clear();
  lastCatalogRemoteSyncMs = 0;
}

// ============================================================================
// INDEXEDDB LOW-LEVEL ENGINE (ArrayBuffer-backed for 100% iOS Safari reliability)
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
    } catch {
      // Non-blocking on browsers that restrict persist prompt
    }

    try {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        quotaBytes = est.quota;
        usageBytes = est.usage;
      }
    } catch {
      // Non-blocking
    }
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
// PURE MP3 SOURCE & VERSION SIGNATURE RESOLVERS
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
  return `${url}|v:${version}|exp:${exportedAt}`;
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
// CATALOG LOCAL CACHE + MINIMAL SUPABASE METADATA SYNC
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

export async function syncPracticeCatalogFromSupabase(options?: {
  force?: boolean;
}): Promise<PracticeCatalogSnapshot | null> {
  const force = Boolean(options?.force);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return readCachedPracticeCatalog();
  }

  const nowMs = Date.now();
  if (!force && memoryCatalogCache && nowMs - lastCatalogRemoteSyncMs < CATALOG_SYNC_COOLDOWN_MS) {
    return memoryCatalogCache;
  }

  try {
    const [setlistsRes, setlistSongsRes, songsRes] = await Promise.all([
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
        .select('id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url, prompter_data')
        .eq('band_id', FAKE_BAND_ID)
        .order('title', { ascending: true }),
    ]);

    if (setlistsRes.error || songsRes.error) {
      return readCachedPracticeCatalog();
    }

    const setlists: PracticeSetlistSummary[] = (setlistsRes.data || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      created_at: s.created_at,
    }));

    const songsList: PracticeSongItem[] = (songsRes.data || []) as PracticeSongItem[];
    const songsById = new Map<string, PracticeSongItem>(songsList.map((s) => [s.id, s]));

    const setlistSongIds = new Set<string>();
    const setlistSongsMap: Record<string, PracticeSongItem[]> = {};
    for (const sl of setlists) {
      setlistSongsMap[sl.id] = [];
    }

    for (const link of setlistSongsRes.data || []) {
      const song = songsById.get((link as any).song_id);
      const slId = (link as any).setlist_id;
      if (song && slId) {
        setlistSongIds.add(song.id);
        if (!setlistSongsMap[slId]) setlistSongsMap[slId] = [];
        setlistSongsMap[slId].push({
          ...song,
          position: (link as any).position,
        });
      }
    }

    // Todas las canciones que están en un Setlist de Live Concert o tienen Mix exportado
    const allLiveSongs = songsList.filter(
      (s) =>
        setlistSongIds.has(s.id) ||
        Boolean(s.foh_mobile_url || s.foh_mix_url || s.cue_mobile_url || s.cue_mix_url)
    );

    const snapshot: PracticeCatalogSnapshot = {
      setlists,
      setlistSongsMap,
      allLiveSongs,
      syncedAt: new Date().toISOString(),
    };

    lastCatalogRemoteSyncMs = nowMs;
    await saveCachedPracticeCatalog(snapshot);
    return snapshot;
  } catch {
    return readCachedPracticeCatalog();
  }
}

// ============================================================================
// MP3 VAULT INDEX & BLOB CRUD (Zero RAM overhead until playback)
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
    } catch {
      // ignore
    }
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

export async function readLocalMp3Blob(
  songId: string,
  channel: 'foh' | 'cue'
): Promise<Blob | null> {
  const blobKey = `${songId}:${channel}`;
  const db = await openVaultDb();

  if (db) {
    const stored = await idbGet<StoredBinaryPayload>(db, STORE_MP3_BLOBS, blobKey);
    if (stored?.buffer && stored.buffer.byteLength > 0) {
      return new Blob([stored.buffer], { type: stored.mimeType || 'audio/mpeg' });
    }
  }

  const mem = memoryBlobMap.get(blobKey);
  if (mem?.buffer && mem.buffer.byteLength > 0) {
    return new Blob([mem.buffer], { type: mem.mimeType || 'audio/mpeg' });
  }

  return null;
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
  const payload: StoredBinaryPayload = {
    key: blobKey,
    buffer,
    mimeType: 'audio/mpeg',
  };

  const db = await openVaultDb();
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
    convertedFromWav: Boolean(convertedFromWav || existingMeta?.convertedFromWav),
  };

  memoryBlobMap.set(blobKey, payload);
  memoryIndexMap.set(songId, nextMeta);

  if (db) {
    await Promise.all([
      idbPut(db, STORE_MP3_BLOBS, payload),
      idbPut(db, STORE_MP3_INDEX, nextMeta),
    ]);
  }

  return nextMeta;
}

function hasRiffWavHeader(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const bytes = new Uint8Array(buffer, 0, 12);
  // 'RIFF' .... 'WAVE'
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

  onProgress?.('Optimizando WAV antiguo a MP3 ligero (160 kbps) para ahorrar memoria...');
  const tempCtx = new AudioCtxClass();
  try {
    const decoded = await tempCtx.decodeAudioData(rawBuffer.slice(0));
    const mp3Blob = await audioBufferToMp3Blob(decoded, 160);
    const mp3Arr = await mp3Blob.arrayBuffer();
    return { buffer: mp3Arr, convertedFromWav: true };
  } finally {
    tempCtx.close().catch(() => {});
  }
}

/**
 * Descarga (SOLO si no está ya en la memoria local o si forceRefresh = true)
 * la pista MP3 de Live Concert y opcionalmente el Click/Voz Guía en MP3,
 * sellándolos en la bóveda IndexedDB del celular/tablet para uso diario con 0 consumo de Supabase.
 */
export async function ensureSongMp3CachedInDevice(params: {
  song: PracticeSongItem;
  includeCue?: boolean;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}): Promise<LocalMp3TrackMeta> {
  const { song, includeCue = true, forceRefresh = false, signal, onProgress } = params;

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
    throw new Error('Esta canción aún no tiene una mezcla exportada para Live Concert.');
  }

  // 1. Verificar / Descargar Pista Musical (FOH MP3)
  const fohAlreadyFresh =
    !forceRefresh &&
    Boolean(currentMeta?.hasFoh) &&
    (!fohSig || currentMeta?.fohSourceSig === fohSig);

  if (!fohAlreadyFresh && fohSrc.url) {
    onProgress?.(`Descargando pista MP3 "${song.title}" a tu dispositivo...`);
    const res = await fetch(fohSrc.url, { signal });
    if (!res.ok) {
      throw new Error(`No se pudo descargar la pista (${res.status})`);
    }
    const rawBuf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || '';
    const { buffer: mp3Buf, convertedFromWav } = await ensureMp3BufferFromFetchedAudio(
      rawBuf,
      contentType,
      fohSrc.isLikelyWav,
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
  }

  // 2. Verificar / Descargar Click & Voz Guía (CUE MP3) si existe y fue solicitado
  if (includeCue && cueSrc.url) {
    const cueAlreadyFresh =
      !forceRefresh &&
      Boolean(currentMeta?.hasCue) &&
      (!cueSig || currentMeta?.cueSourceSig === cueSig);

    if (!cueAlreadyFresh) {
      onProgress?.(`Guardando Click y Voz Guía MP3 de "${song.title}"...`);
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
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        // Si falla la descarga secundaria de CUE pero FOH ya está listo, conservamos FOH funcional
      }
    }
  }

  if (!currentMeta) {
    throw new Error('No fue posible almacenar la pista en la memoria local.');
  }

  onProgress?.('');
  return currentMeta;
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

export async function clearAllLocalMp3Vault(): Promise<void> {
  const keys = Array.from(memoryIndexMap.keys());
  memoryIndexMap.clear();
  memoryBlobMap.clear();

  const db = await openVaultDb();
  if (db) {
    const allMeta = await idbGetAll<LocalMp3TrackMeta>(db, STORE_MP3_INDEX);
    const ids = Array.from(new Set([...keys, ...allMeta.map((m) => m.songId)]));
    await Promise.all(
      ids.flatMap((id) => [
        idbDelete(db, STORE_MP3_INDEX, id),
        idbDelete(db, STORE_MP3_BLOBS, `${id}:foh`),
        idbDelete(db, STORE_MP3_BLOBS, `${id}:cue`),
      ])
    );
  }
}
