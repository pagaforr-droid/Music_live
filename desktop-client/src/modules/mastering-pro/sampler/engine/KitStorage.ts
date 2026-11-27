import { encodeAudioBufferToWav24Bit } from '../../engine/Wav24BitEncoder';
import type {
  CustomReplacementSampleItem,
  CustomSampleCategory,
  PersistedStemReplacerSession,
  SampleKit,
  SampleSource,
  SerializedSampleSource,
} from '../types/sampler.types';

/**
 * Temporary Local Persistence in IndexedDB ('tandao_sample_lab_v1').
 * Stores full 24-bit WAV source blobs, kit state, StemReplacer session state,
 * and user-uploaded custom replacement samples safely (avoiding localStorage 5MB limit)
 * so loaded audio and configurations survive page refreshes and tab switches.
 */

const DB_NAME = 'tandao_sample_lab_v1';
const DB_VERSION = 3;
const STORE_KITS = 'kits';
const STORE_SOURCES = 'source_blobs';
const STORE_CUSTOM_SAMPLES = 'custom_replacement_samples';
const STORE_REPLACER_SESSIONS = 'replacer_sessions';
const ACTIVE_KIT_KEY = '__active_temp_kit__';
export const ACTIVE_REPLACER_SESSION_KEY = '__active_replacer_session__';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KITS)) {
        db.createObjectStore(STORE_KITS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SOURCES)) {
        db.createObjectStore(STORE_SOURCES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM_SAMPLES)) {
        db.createObjectStore(STORE_CUSTOM_SAMPLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_REPLACER_SESSIONS)) {
        db.createObjectStore(STORE_REPLACER_SESSIONS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txRun<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveKitTempToIndexedDb(
  kit: SampleKit,
  sources: SampleSource[],
  storageId = ACTIVE_KIT_KEY
): Promise<void> {
  try {
    const db = await openDb();
    const serializedSources: SerializedSampleSource[] = [];

    for (const src of sources) {
      const blobKey = `src:${src.id}`;
      // Only encode & write blob if not already saved in IndexedDB
      const existing = await txRun<{ key: string; blob: Blob } | undefined>(
        db,
        STORE_SOURCES,
        'readonly',
        (s) => s.get(blobKey)
      );
      if (!existing) {
        const wavBlob = encodeAudioBufferToWav24Bit(src.buffer, false);
        await txRun(db, STORE_SOURCES, 'readwrite', (s) =>
          s.put({ key: blobKey, blob: wavBlob, updatedAt: Date.now() })
        );
      }

      serializedSources.push({
        id: src.id,
        name: src.name,
        origin: src.origin,
        bpm: src.bpm,
        rootNote: src.rootNote,
        sampleRate: src.buffer.sampleRate,
        durationSec: src.buffer.duration,
        wavBlobKey: blobKey,
        provenance: src.provenance,
      });
    }

    const record: SampleKit & { storageId: string } = {
      ...kit,
      id: storageId === ACTIVE_KIT_KEY ? ACTIVE_KIT_KEY : kit.id,
      storageId,
      sources: serializedSources,
      updatedAt: new Date().toISOString(),
    };

    await txRun(db, STORE_KITS, 'readwrite', (s) => s.put(record));
    db.close();
  } catch {
    // Graceful no-op if IndexedDB is blocked
  }
}

export async function loadKitTempFromIndexedDb(
  ctx: AudioContext,
  storageId = ACTIVE_KIT_KEY
): Promise<{ kit: SampleKit; sources: SampleSource[] } | null> {
  try {
    const db = await openDb();
    const record = await txRun<SampleKit | undefined>(
      db,
      STORE_KITS,
      'readonly',
      (s) => s.get(storageId)
    );
    if (!record) {
      db.close();
      return null;
    }

    const loadedSources: SampleSource[] = [];
    for (const sMeta of record.sources) {
      const entry = await txRun<{ key: string; blob: Blob } | undefined>(
        db,
        STORE_SOURCES,
        'readonly',
        (s) => s.get(sMeta.wavBlobKey)
      );
      if (!entry?.blob) continue;
      const arr = await entry.blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr.slice(0));
      loadedSources.push({
        id: sMeta.id,
        name: sMeta.name,
        origin: sMeta.origin,
        buffer: decoded,
        bpm: sMeta.bpm,
        rootNote: sMeta.rootNote,
        provenance: sMeta.provenance,
      });
    }

    db.close();
    if (loadedSources.length === 0 && record.regions.length > 0) {
      return null;
    }
    return { kit: record, sources: loadedSources };
  } catch {
    return null;
  }
}

export async function listSavedLocalKits(): Promise<SampleKit[]> {
  try {
    const db = await openDb();
    const all = await txRun<SampleKit[]>(db, STORE_KITS, 'readonly', (s) =>
      s.getAll()
    );
    db.close();
    return (all || [])
      .filter((k) => k.id !== ACTIVE_KIT_KEY)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function deleteLocalKit(kitId: string): Promise<void> {
  try {
    const db = await openDb();
    await txRun(db, STORE_KITS, 'readwrite', (s) => s.delete(kitId));
    db.close();
  } catch {
    // ignore
  }
}

interface StoredCustomReplacementRecord {
  id: string;
  name: string;
  category: CustomSampleCategory;
  sourceType: 'file' | 'recorded' | 'pad' | 'cloud' | 'kit-1400';
  kit1400Id?: string;
  cloudUrl?: string;
  supabaseSynced?: boolean;
  wavBlob: Blob;
  durationSec: number;
  peakOffsetSec: number;
  detectedRootMidi: number;
  detectedNoteName: string;
  waveformPreview: number[];
  createdAt: string;
}

export async function saveCustomReplacementSampleToIdb(
  item: CustomReplacementSampleItem
): Promise<void> {
  try {
    const db = await openDb();
    const wavBlob = encodeAudioBufferToWav24Bit(item.buffer, false);
    const rec: StoredCustomReplacementRecord = {
      id: item.id,
      name: item.name,
      category: item.category,
      sourceType: item.sourceType,
      kit1400Id: item.kit1400Id,
      cloudUrl: item.cloudUrl,
      supabaseSynced: item.supabaseSynced,
      wavBlob,
      durationSec: item.durationSec,
      peakOffsetSec: item.peakOffsetSec,
      detectedRootMidi: item.detectedRootMidi,
      detectedNoteName: item.detectedNoteName,
      waveformPreview: item.waveformPreview,
      createdAt: item.createdAt,
    };
    await txRun(db, STORE_CUSTOM_SAMPLES, 'readwrite', (s) => s.put(rec));
    db.close();
  } catch {
    // Graceful no-op if IndexedDB is blocked
  }
}

export async function loadAllCustomReplacementSamplesFromIdb(
  ctx: AudioContext
): Promise<CustomReplacementSampleItem[]> {
  try {
    const db = await openDb();
    const all = await txRun<StoredCustomReplacementRecord[]>(
      db,
      STORE_CUSTOM_SAMPLES,
      'readonly',
      (s) => s.getAll()
    );
    db.close();
    const out: CustomReplacementSampleItem[] = [];
    for (const rec of all || []) {
      try {
        const arr = await rec.wavBlob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr.slice(0));
        out.push({
          id: rec.id,
          name: rec.name,
          category: rec.category,
          sourceType: rec.sourceType,
          kit1400Id: rec.kit1400Id,
          cloudUrl: rec.cloudUrl,
          supabaseSynced: rec.supabaseSynced,
          buffer: decoded,
          durationSec: rec.durationSec || decoded.duration,
          peakOffsetSec: rec.peakOffsetSec,
          detectedRootMidi: rec.detectedRootMidi,
          detectedNoteName: rec.detectedNoteName,
          waveformPreview: rec.waveformPreview || [],
          createdAt: rec.createdAt,
        });
      } catch {
        // skip corrupted entry
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function deleteCustomReplacementSampleFromIdb(id: string): Promise<void> {
  try {
    const db = await openDb();
    await txRun(db, STORE_CUSTOM_SAMPLES, 'readwrite', (s) => s.delete(id));
    db.close();
  } catch {
    // ignore
  }
}

export async function saveReplacerSessionToIdb(
  session: PersistedStemReplacerSession
): Promise<void> {
  try {
    const db = await openDb();
    await txRun(db, STORE_REPLACER_SESSIONS, 'readwrite', (s) =>
      s.put({
        ...session,
        updatedAt: new Date().toISOString(),
      })
    );
    db.close();
  } catch {
    // Graceful no-op if IndexedDB is unavailable
  }
}

export async function loadReplacerSessionFromIdb(
  sessionId = ACTIVE_REPLACER_SESSION_KEY
): Promise<PersistedStemReplacerSession | null> {
  try {
    const db = await openDb();
    const record = await txRun<PersistedStemReplacerSession | undefined>(
      db,
      STORE_REPLACER_SESSIONS,
      'readonly',
      (s) => s.get(sessionId)
    );
    db.close();
    return record ?? null;
  } catch {
    return null;
  }
}
