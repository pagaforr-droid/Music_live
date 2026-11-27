import { supabase } from '../../../../lib/supabase';
import { encodeAudioBufferToWav24Bit } from '../../engine/Wav24BitEncoder';
import { inferStemModeFromName } from '../engine/FullStemAnalyzer';
import type {
  CloudDrumKitSampleRecord,
  CloudSampleKitRecord,
  CustomReplacementSampleItem,
  PersistedCloudDrumSelection,
  SampleKit,
  SampleSource,
  SongFolderItem,
  SongStemEntry,
  SongWithStemsFolder,
} from '../types/sampler.types';

const DEFAULT_BAND_ID = '00000000-0000-0000-0000-000000000000';
const DRUM_KIT_CLOUD_PREFIX = 'drum-kit-1400';
const ACTIVE_DRUM_SELECTION_ID = '__active_drum_selection__';
const CLOUD_SELECTION_STORAGE_PATH = `${DRUM_KIT_CLOUD_PREFIX}/_active_drum_selection.json`;
const CLOUD_SAMPLES_INDEX_STORAGE_PATH = `${DRUM_KIT_CLOUD_PREFIX}/_cloud_samples_index.json`;
const LOCAL_CLOUD_URL_CACHE_KEY = 'tandao_drum_kit_1400_cloud_urls_v1';

export const SAMPLE_KITS_MIGRATION_SQL = `
-- ============================================================================
-- MIGRACIÓN SQL: Sample Lab (Kits + 1400 Samples Drum Kit + Selección Activa)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('samples', 'samples', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('audios', 'audios', true)
on conflict (id) do nothing;

create table if not exists public.sample_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  song_id uuid null,
  name text not null,
  kit_json jsonb not null,
  total_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sample_kits enable row level security;

create table if not exists public.drum_kit_cloud_samples (
  id text primary key,
  user_id uuid null references auth.users(id) on delete set null,
  band_id uuid not null default '00000000-0000-0000-0000-000000000000',
  folder text not null,
  file_name text not null,
  display_name text not null,
  category text not null check (category in ('kick', 'snare', 'hat', 'crash', 'tom', 'melodic')),
  storage_bucket text not null default 'audios',
  storage_path text not null,
  public_url text not null,
  duration_sec numeric(8,4) not null default 0,
  peak_offset_sec numeric(8,5) not null default 0,
  detected_root_midi integer not null default 60,
  file_size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drum_kit_cloud_samples enable row level security;

create policy "drum_kit_cloud_samples_all"
  on public.drum_kit_cloud_samples for all
  using (true)
  with check (true);

create table if not exists public.drum_kit_selections (
  id text primary key,
  user_id uuid null references auth.users(id) on delete set null,
  band_id uuid not null default '00000000-0000-0000-0000-000000000000',
  name text not null default 'Configuración Activa Sample Lab',
  slots_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.drum_kit_selections enable row level security;

create policy "drum_kit_selections_all"
  on public.drum_kit_selections for all
  using (true)
  with check (true);
`;

function sanitizeStorageName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function readLocalCloudUrlCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_CLOUD_URL_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeLocalCloudUrlCache(id: string, url: string): void {
  try {
    const cur = readLocalCloudUrlCache();
    cur[id] = url;
    localStorage.setItem(LOCAL_CLOUD_URL_CACHE_KEY, JSON.stringify(cur));
  } catch {
    // ignore storage quota errors
  }
}

export function getCachedSupabaseSampleUrl(sampleKey: string): string | undefined {
  return readLocalCloudUrlCache()[sampleKey];
}

/**
 * Fetches existing Song Folders ("Temas / Carpetas de pistas") from Supabase public.songs.
 */
export async function fetchSongFoldersForSampler(): Promise<SongFolderItem[]> {
  try {
    const { data: songs, error } = await supabase
      .from('songs')
      .select('id, title, band_id, created_at')
      .order('title', { ascending: true })
      .limit(100);

    if (error || !songs) return [];

    const { data: stemRows } = await supabase
      .from('stems')
      .select('song_id')
      .in(
        'song_id',
        songs.map((s) => s.id)
      );

    const counts = new Map<string, number>();
    if (stemRows) {
      for (const r of stemRows) {
        counts.set(r.song_id, (counts.get(r.song_id) ?? 0) + 1);
      }
    }

    return songs.map((s) => ({
      id: s.id,
      title: s.title || 'Tema sin título',
      band_id: s.band_id,
      stemCount: counts.get(s.id) ?? 0,
      created_at: s.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Creates a new Song Folder ("Tema") in public.songs so Sample Lab can add tracks directly into it.
 */
export async function createSongFolderForSampler(
  title: string
): Promise<SongFolderItem> {
  const cleanTitle = title.trim() || 'Nuevo Tema Sample Lab';
  const { data, error } = await supabase
    .from('songs')
    .insert({ band_id: DEFAULT_BAND_ID, title: cleanTitle })
    .select('id, title, band_id, created_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'No se pudo crear la carpeta del tema.');
  }

  return {
    id: data.id,
    title: data.title,
    band_id: data.band_id,
    stemCount: 0,
    created_at: data.created_at,
  };
}

/**
 * Fetches songs with their stems grouped by Song Folder ("Canción -> Stems")
 * including BPM, musical key, and inferred analysis mode per stem.
 */
export async function fetchSongsWithStemsForSampler(): Promise<SongWithStemsFolder[]> {
  try {
    const { data: songs, error } = await supabase
      .from('songs')
      .select('id, title, band_id, prompter_data, created_at')
      .order('title', { ascending: true })
      .limit(120);

    if (error || !songs || songs.length === 0) return [];

    const { data: stems } = await supabase
      .from('stems')
      .select('id, song_id, name, file_url, metadata')
      .in(
        'song_id',
        songs.map((s) => s.id)
      )
      .order('name', { ascending: true });

    const bySong = new Map<string, SongStemEntry[]>();
    if (stems) {
      for (const st of stems) {
        if (!st.file_url) continue;
        const meta = (st.metadata || {}) as Record<string, unknown>;
        const list = bySong.get(st.song_id) ?? [];
        list.push({
          id: st.id,
          songId: st.song_id,
          name: st.name || 'Stem',
          fileUrl: st.file_url,
          isMaster: Boolean(meta.is_master),
          durationSec:
            typeof meta.duration_seconds === 'number'
              ? meta.duration_seconds
              : undefined,
          inferredMode: inferStemModeFromName(st.name || ''),
        });
        bySong.set(st.song_id, list);
      }
    }

    return songs.map((s) => {
      const pd = (s.prompter_data || {}) as Record<string, unknown>;
      const rawBeats = Array.isArray(pd.beatTimes)
        ? (pd.beatTimes as unknown[]).map(Number).filter((v) => Number.isFinite(v) && v >= 0)
        : undefined;
      const rawDownbeats = Array.isArray(pd.downbeats)
        ? (pd.downbeats as unknown[]).map(Number).filter((v) => Number.isFinite(v) && v >= 0)
        : undefined;
      const rawChords = Array.isArray(pd.chords)
        ? (pd.chords as Array<Record<string, unknown>>)
            .map((c) => {
              const t = Number(c.time ?? c.start ?? c.timeSec ?? 0);
              const chord = typeof c.chord === 'string' ? c.chord.trim() : '';
              return Number.isFinite(t) && chord ? { timeSec: t, chord } : null;
            })
            .filter((x): x is { timeSec: number; chord: string } => x !== null)
        : undefined;
      return {
        id: s.id,
        title: s.title || 'Canción sin título',
        bandId: s.band_id,
        bpm: pd.bpm ? Math.round(Number(pd.bpm)) : undefined,
        musicalKey: typeof pd.key === 'string' ? pd.key : undefined,
        timeSignature:
          typeof pd.timeSignature === 'string' ? pd.timeSignature : undefined,
        beatTimes: rawBeats && rawBeats.length > 4 ? rawBeats : undefined,
        downbeats: rawDownbeats && rawDownbeats.length > 0 ? rawDownbeats : undefined,
        firstBeatOffset:
          typeof pd.firstBeatOffset === 'number' && Number.isFinite(pd.firstBeatOffset)
            ? pd.firstBeatOffset
            : undefined,
        prompterChords: rawChords && rawChords.length > 0 ? rawChords : undefined,
        stems: bySong.get(s.id) ?? [],
      };
    });
  } catch {
    return [];
  }
}

/**
 * Uploads a rendered WAV 24-bit sample/loop/bounce to Supabase Storage ('audios' bucket)
 * and registers it inside public.stems of the chosen Song Folder ("Tema") so it appears
 * immediately in Stem Studio, Live Concert, and Mastering Pro.
 */
export async function addSampleToSongFolder(params: {
  songId: string;
  bandId?: string;
  sampleName: string;
  wavBlob: Blob;
  durationSec: number;
  bpm?: number;
  rootNote?: number;
  originKind: 'pad' | 'region' | 'bounce' | 'stem-replaced';
}): Promise<{ fileUrl: string; stemName: string }> {
  const ts = Date.now();
  const baseName = params.sampleName.replace(/\.[^.]+$/, '').trim() || 'Sample';
  const safeFile = `${ts}_${sanitizeStorageName(baseName)}.wav`;
  const bandFolder = params.bandId || DEFAULT_BAND_ID;
  const storagePath = `${bandFolder}/${params.songId}/${safeFile}`;

  const { error: uploadErr } = await supabase.storage
    .from('audios')
    .upload(storagePath, params.wavBlob, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Error subiendo audio a Storage: ${uploadErr.message}`);
  }

  const { data: pubData } = supabase.storage
    .from('audios')
    .getPublicUrl(storagePath);

  const { error: dbErr } = await supabase.from('stems').insert({
    song_id: params.songId,
    name: baseName,
    file_url: pubData.publicUrl,
    type: 'Audio',
    metadata: {
      duration_seconds: Math.max(1, Math.round(params.durationSec)),
      format: 'audio/wav',
      original_name: `${baseName}.wav`,
      origin: 'sample-lab',
      sample_kind: params.originKind,
      bpm: params.bpm,
      root_midi_note: params.rootNote,
      is_master: false,
    },
  });

  if (dbErr) {
    throw new Error(`Audio subido pero error registrando stem: ${dbErr.message}`);
  }

  return { fileUrl: pubData.publicUrl, stemName: baseName };
}

/**
 * Uploads a selected drum sample (from "1400 Samples Drum Kit" or user custom sample)
 * to Supabase Storage ('audios' / 'samples' bucket) AND registers it in Supabase DB
 * ('drum_kit_cloud_samples' + cloud JSON index fallback so it works even before SQL migration).
 */
export async function uploadDrumKitSampleToSupabase(params: {
  sample: CustomReplacementSampleItem;
  folderHint?: string;
}): Promise<CloudDrumKitSampleRecord> {
  const { sample } = params;
  const stableId = sample.kit1400Id || sample.id;
  const folder =
    params.folderHint ||
    (sample.kit1400Id?.startsWith('dk1400:')
      ? sample.kit1400Id.slice(7).split('/')[0]
      : sample.category.toUpperCase());
  const rawFileName =
    sample.kit1400Id?.startsWith('dk1400:')
      ? sample.kit1400Id.slice(7).split('/').slice(1).join('_')
      : `${sample.name.replace(/\.[^.]+$/, '')}.wav`;
  const safeFile = sanitizeStorageName(rawFileName.endsWith('.wav') ? rawFileName : `${rawFileName}.wav`);
  const wavBlob = encodeAudioBufferToWav24Bit(sample.buffer, false);

  const storagePath = `${DRUM_KIT_CLOUD_PREFIX}/${sanitizeStorageName(folder)}/${safeFile}`;
  let storageBucket = 'audios';
  let publicUrl = '';

  const { error: audiosErr } = await supabase.storage
    .from('audios')
    .upload(storagePath, wavBlob, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (!audiosErr) {
    storageBucket = 'audios';
    publicUrl = supabase.storage.from('audios').getPublicUrl(storagePath).data.publicUrl;
  } else {
    const { error: samplesErr } = await supabase.storage
      .from('samples')
      .upload(storagePath, wavBlob, {
        contentType: 'audio/wav',
        upsert: true,
      });
    if (samplesErr) {
      throw new Error(`No se pudo subir muestra a Supabase Storage: ${audiosErr.message}`);
    }
    storageBucket = 'samples';
    publicUrl = supabase.storage.from('samples').getPublicUrl(storagePath).data.publicUrl;
  }

  let userId: string | null = null;
  try {
    const { data: authData } = await supabase.auth.getUser();
    userId = authData?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const nowIso = new Date().toISOString();
  const record: CloudDrumKitSampleRecord = {
    id: stableId,
    folder,
    fileName: rawFileName,
    displayName: sample.name,
    category: sample.category,
    storageBucket,
    storagePath,
    publicUrl,
    durationSec: Number(sample.durationSec.toFixed(4)),
    peakOffsetSec: Number(sample.peakOffsetSec.toFixed(5)),
    detectedRootMidi: sample.detectedRootMidi,
    fileSizeBytes: wavBlob.size,
    updatedAt: nowIso,
  };

  writeLocalCloudUrlCache(stableId, publicUrl);

  // 1. Upsert into public.drum_kit_cloud_samples table (if migrated)
  try {
    await supabase.from('drum_kit_cloud_samples').upsert(
      {
        id: record.id,
        user_id: userId,
        band_id: DEFAULT_BAND_ID,
        folder: record.folder,
        file_name: record.fileName,
        display_name: record.displayName,
        category: record.category,
        storage_bucket: record.storageBucket,
        storage_path: record.storagePath,
        public_url: record.publicUrl,
        duration_sec: record.durationSec,
        peak_offset_sec: record.peakOffsetSec,
        detected_root_midi: record.detectedRootMidi,
        file_size_bytes: record.fileSizeBytes,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );
  } catch {
    // Table may not be migrated yet; Storage manifest below guarantees persistence
  }

  // 2. Also maintain lightweight cloud JSON index in 'audios' bucket so samples persist without SQL setup
  try {
    const existingList = await fetchCloudDrumKitSamplesFromStorageIndex();
    const map = new Map(existingList.map((r) => [r.id, r]));
    map.set(record.id, record);
    const merged = Array.from(map.values()).slice(-300);
    const indexBlob = new Blob([JSON.stringify(merged)], { type: 'application/json' });
    await supabase.storage.from('audios').upload(CLOUD_SAMPLES_INDEX_STORAGE_PATH, indexBlob, {
      contentType: 'application/json',
      upsert: true,
    });
  } catch {
    // non-fatal index update
  }

  return record;
}

async function fetchCloudDrumKitSamplesFromStorageIndex(): Promise<CloudDrumKitSampleRecord[]> {
  try {
    const { data, error } = await supabase.storage
      .from('audios')
      .download(CLOUD_SAMPLES_INDEX_STORAGE_PATH);
    if (error || !data) return [];
    const text = await data.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as CloudDrumKitSampleRecord[]) : [];
  } catch {
    return [];
  }
}

export async function fetchCloudDrumKitSamples(): Promise<CloudDrumKitSampleRecord[]> {
  const byId = new Map<string, CloudDrumKitSampleRecord>();

  try {
    const { data, error } = await supabase
      .from('drum_kit_cloud_samples')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(300);
    if (!error && Array.isArray(data)) {
      for (const row of data as Array<Record<string, unknown>>) {
        const rec: CloudDrumKitSampleRecord = {
          id: String(row.id),
          folder: String(row.folder || 'Custom'),
          fileName: String(row.file_name || ''),
          displayName: String(row.display_name || row.file_name || 'Sample'),
          category: (row.category as CloudDrumKitSampleRecord['category']) || 'kick',
          storageBucket: String(row.storage_bucket || 'audios'),
          storagePath: String(row.storage_path || ''),
          publicUrl: String(row.public_url || ''),
          durationSec: Number(row.duration_sec || 0),
          peakOffsetSec: Number(row.peak_offset_sec || 0),
          detectedRootMidi: Number(row.detected_root_midi || 60),
          fileSizeBytes: Number(row.file_size_bytes || 0),
          updatedAt: String(row.updated_at || new Date().toISOString()),
        };
        if (rec.publicUrl) {
          byId.set(rec.id, rec);
          writeLocalCloudUrlCache(rec.id, rec.publicUrl);
        }
      }
    }
  } catch {
    // fallback to storage index
  }

  const fromStorage = await fetchCloudDrumKitSamplesFromStorageIndex();
  for (const item of fromStorage) {
    if (item?.id && item.publicUrl && !byId.has(item.id)) {
      byId.set(item.id, item);
      writeLocalCloudUrlCache(item.id, item.publicUrl);
    }
  }

  return Array.from(byId.values());
}

/**
 * Persists the user's active Drum Replacer slot selection (Kick, Snare, Hat, Tom, Crash, Melodic)
 * in Supabase ('drum_kit_selections' table + 'audios' Storage JSON fallback) so their chosen
 * sounds from "1400 Samples Drum Kit" are remembered across sessions and devices.
 */
export async function saveDrumReplacerSelectionToSupabase(
  selection: Omit<PersistedCloudDrumSelection, 'id' | 'updatedAt'>
): Promise<PersistedCloudDrumSelection> {
  const nowIso = new Date().toISOString();
  let userId: string | null = null;
  try {
    const { data: authData } = await supabase.auth.getUser();
    userId = authData?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const selectionId = userId ? `user_${userId}_drum_selection` : ACTIVE_DRUM_SELECTION_ID;
  const payload: PersistedCloudDrumSelection = {
    id: selectionId,
    name: selection.name || 'Selección Predeterminada Sample Lab',
    drumSlots: selection.drumSlots,
    melodicSlot: selection.melodicSlot,
    updatedAt: nowIso,
  };

  let savedToTable = false;
  try {
    const { error } = await supabase.from('drum_kit_selections').upsert(
      {
        id: selectionId,
        user_id: userId,
        band_id: DEFAULT_BAND_ID,
        name: payload.name,
        slots_json: payload,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );
    if (!error) savedToTable = true;
  } catch {
    savedToTable = false;
  }

  const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const { error: storageErr } = await supabase.storage
    .from('audios')
    .upload(CLOUD_SELECTION_STORAGE_PATH, jsonBlob, {
      contentType: 'application/json',
      upsert: true,
    });

  if (!savedToTable && storageErr) {
    throw new Error(`No se pudo sincronizar selección con Supabase: ${storageErr.message}`);
  }

  return payload;
}

export async function loadDrumReplacerSelectionFromSupabase(): Promise<PersistedCloudDrumSelection | null> {
  try {
    let userId: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id ?? null;
    } catch {
      userId = null;
    }
    const targetIds = userId
      ? [`user_${userId}_drum_selection`, ACTIVE_DRUM_SELECTION_ID]
      : [ACTIVE_DRUM_SELECTION_ID];

    const { data, error } = await supabase
      .from('drum_kit_selections')
      .select('slots_json, updated_at')
      .in('id', targetIds)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0 && data[0].slots_json) {
      return data[0].slots_json as PersistedCloudDrumSelection;
    }
  } catch {
    // fallback to storage JSON
  }

  try {
    const { data, error } = await supabase.storage
      .from('audios')
      .download(CLOUD_SELECTION_STORAGE_PATH);
    if (error || !data) return null;
    const raw = await data.text();
    const parsed = JSON.parse(raw) as PersistedCloudDrumSelection;
    return parsed?.drumSlots ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves an entire Sample Lab Kit + audio source WAVs to Supabase ('samples' bucket fallback 'audios/samples')
 * and persists kit JSON in public.sample_kits (with Storage JSON fallback for studio/band sessions without auth).
 */
export async function saveKitToSupabase(params: {
  kit: SampleKit;
  sources: SampleSource[];
  songId?: string | null;
}): Promise<CloudSampleKitRecord> {
  let userId: string | null = null;
  try {
    const { data: authData } = await supabase.auth.getUser();
    userId = authData?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const ownerFolder = userId || DEFAULT_BAND_ID;
  const kitId =
    params.kit.id && params.kit.id.length === 36
      ? params.kit.id
      : crypto.randomUUID();
  let totalBytes = 0;
  const serializedSources = [];

  for (const src of params.sources) {
    const wavBlob = encodeAudioBufferToWav24Bit(src.buffer, false);
    totalBytes += wavBlob.size;
    const safeName = sanitizeStorageName(src.name || src.id);
    const path = `${ownerFolder}/${kitId}/${src.id}_${safeName}.wav`;

    let uploadedUrl = '';
    const { error: samplesErr } = await supabase.storage
      .from('samples')
      .upload(path, wavBlob, { contentType: 'audio/wav', upsert: true });

    if (!samplesErr) {
      uploadedUrl = `samples://${path}`;
    } else {
      const fallbackPath = `samples/${path}`;
      const { error: audiosErr } = await supabase.storage
        .from('audios')
        .upload(fallbackPath, wavBlob, {
          contentType: 'audio/wav',
          upsert: true,
        });
      if (audiosErr) {
        throw new Error(`Error subiendo audio del kit: ${audiosErr.message}`);
      }
      uploadedUrl = supabase.storage
        .from('audios')
        .getPublicUrl(fallbackPath).data.publicUrl;
    }

    serializedSources.push({
      id: src.id,
      name: src.name,
      origin: src.origin,
      bpm: src.bpm,
      rootNote: src.rootNote,
      sampleRate: src.buffer.sampleRate,
      durationSec: src.buffer.duration,
      wavBlobKey: uploadedUrl,
      provenance: src.provenance,
    });
  }

  const updatedKit: SampleKit = {
    ...params.kit,
    id: kitId,
    sources: serializedSources,
    updatedAt: new Date().toISOString(),
  };

  const fallbackRecord: CloudSampleKitRecord = {
    id: kitId,
    user_id: userId,
    song_id: params.songId ?? null,
    name: updatedKit.name,
    kit_json: updatedKit,
    total_bytes: totalBytes,
    updated_at: updatedKit.updatedAt,
  };

  // Also save kit JSON inside 'audios' Storage so kits work even without auth/RLS migration
  const kitJsonPath = `samples/${ownerFolder}/kits/${kitId}.json`;
  await supabase.storage
    .from('audios')
    .upload(kitJsonPath, new Blob([JSON.stringify(fallbackRecord)], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true,
    });

  if (userId) {
    const { data, error } = await supabase
      .from('sample_kits')
      .upsert(
        {
          id: kitId,
          user_id: userId,
          song_id: params.songId ?? null,
          name: updatedKit.name,
          kit_json: updatedKit,
          total_bytes: totalBytes,
          updated_at: updatedKit.updatedAt,
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (!error && data) {
      return data as CloudSampleKitRecord;
    }
  }

  return fallbackRecord;
}

export async function fetchCloudSampleKits(): Promise<CloudSampleKitRecord[]> {
  const out = new Map<string, CloudSampleKitRecord>();
  try {
    const { data, error } = await supabase
      .from('sample_kits')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(30);
    if (!error && data) {
      for (const r of data as CloudSampleKitRecord[]) {
        out.set(r.id, r);
      }
    }
  } catch {
    // continue to storage fallback
  }

  try {
    const { data: listData } = await supabase.storage
      .from('audios')
      .list(`samples/${DEFAULT_BAND_ID}/kits`, { limit: 30 });
    if (listData) {
      for (const item of listData) {
        if (!item.name.endsWith('.json')) continue;
        const { data: blob } = await supabase.storage
          .from('audios')
          .download(`samples/${DEFAULT_BAND_ID}/kits/${item.name}`);
        if (!blob) continue;
        const rec = JSON.parse(await blob.text()) as CloudSampleKitRecord;
        if (rec?.id && !out.has(rec.id)) {
          out.set(rec.id, rec);
        }
      }
    }
  } catch {
    // ignore
  }

  return Array.from(out.values()).sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || '')
  );
}

export async function loadCloudKitSources(
  kitRecord: CloudSampleKitRecord,
  ctx: AudioContext
): Promise<SampleSource[]> {
  const out: SampleSource[] = [];
  for (const sMeta of kitRecord.kit_json.sources) {
    let arrayBuf: ArrayBuffer;
    if (sMeta.wavBlobKey.startsWith('samples://')) {
      const storagePath = sMeta.wavBlobKey.replace('samples://', '');
      const { data, error } = await supabase.storage
        .from('samples')
        .download(storagePath);
      if (error || !data) continue;
      arrayBuf = await data.arrayBuffer();
    } else {
      const res = await fetch(sMeta.wavBlobKey);
      if (!res.ok) continue;
      arrayBuf = await res.arrayBuffer();
    }
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    out.push({
      id: sMeta.id,
      name: sMeta.name,
      origin: sMeta.origin,
      buffer: decoded,
      bpm: sMeta.bpm,
      rootNote: sMeta.rootNote,
      provenance: sMeta.provenance,
    });
  }
  return out;
}
