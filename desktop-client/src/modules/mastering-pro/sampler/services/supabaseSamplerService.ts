import { supabase } from '../../../../lib/supabase';
import { encodeAudioBufferToWav24Bit } from '../../engine/Wav24BitEncoder';
import { inferStemModeFromName } from '../engine/FullStemAnalyzer';
import type {
  CloudSampleKitRecord,
  SampleKit,
  SampleSource,
  SongFolderItem,
  SongStemEntry,
  SongWithStemsFolder,
} from '../types/sampler.types';

const DEFAULT_BAND_ID = '00000000-0000-0000-0000-000000000000';

export const SAMPLE_KITS_MIGRATION_SQL = `
-- ============================================================================
-- MIGRACIÓN SQL: Sample Lab (Tabla sample_kits + Bucket 'samples')
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('samples', 'samples', false)
on conflict (id) do nothing;

create table if not exists public.sample_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid null,
  name text not null,
  kit_json jsonb not null,
  total_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sample_kits enable row level security;

create policy "kits_owner_select"
  on public.sample_kits for select
  using (auth.uid() = user_id);

create policy "kits_owner_write"
  on public.sample_kits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
`;

function sanitizeStorageName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
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
 * Saves an entire Sample Lab Kit + audio source WAVs to Supabase ('samples' bucket fallback 'audios/samples')
 * and persists kit JSON in public.sample_kits ready for future export or loading.
 */
export async function saveKitToSupabase(params: {
  kit: SampleKit;
  sources: SampleSource[];
  songId?: string | null;
}): Promise<CloudSampleKitRecord> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) {
    throw new Error('Debes iniciar sesión para guardar kits en Supabase.');
  }

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
    const path = `${userId}/${kitId}/${src.id}_${safeName}.wav`;

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

  if (error) {
    throw new Error(
      `Error guardando en tabla sample_kits (¿ejecutaste la migración SQL?): ${error.message}`
    );
  }

  return data as CloudSampleKitRecord;
}

export async function fetchCloudSampleKits(): Promise<CloudSampleKitRecord[]> {
  try {
    const { data, error } = await supabase
      .from('sample_kits')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(30);
    if (error || !data) return [];
    return data as CloudSampleKitRecord[];
  } catch {
    return [];
  }
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
