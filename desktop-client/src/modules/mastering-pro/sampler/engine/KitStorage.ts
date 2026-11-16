import { encodeAudioBufferToWav24Bit } from '../../engine/Wav24BitEncoder';
import type { SampleKit, SampleSource, SerializedSampleSource } from '../types/sampler.types';

/**
 * Temporary Local Persistence in IndexedDB ('tandao_sample_lab_v1').
 * Stores full 24-bit WAV source blobs + kit state safely (avoiding localStorage 5MB limit)
 * so loaded audio, chops, pads, and patterns survive page refreshes and route changes.
 */

const DB_NAME = 'tandao_sample_lab_v1';
const DB_VERSION = 1;
const STORE_KITS = 'kits';
const STORE_SOURCES = 'source_blobs';
const ACTIVE_KIT_KEY = '__active_temp_kit__';

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
