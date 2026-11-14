import { supabase } from '../../../lib/supabase';
import type {
  MasteringDspChain,
  MasteringSessionRecord,
  SurgicalOverrides,
} from '../types/mastering.types';

export const MASTERING_SESSIONS_MIGRATION_SQL = `
-- ============================================================================
-- MIGRACIÓN SQL: StudioMasteringModule (Supabase Storage + Tabla de Sesiones)
-- ============================================================================

-- 1. Crear el bucket público 'masters' para archivos WAV de 24-bits
insert into storage.buckets (id, name, public)
values ('masters', 'masters', true)
on conflict (id) do nothing;

-- 2. Crear tabla de sesiones e historial de masterización
create table if not exists public.mastering_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  song_id uuid null,
  track_title text not null,
  preset_id text not null,
  preset_name text not null,
  intensity_pct integer not null default 100,
  target_lufs numeric(5,2) not null default -11.0,
  input_lufs numeric(5,2) not null,
  output_lufs numeric(5,2) not null,
  true_peak_dbtp numeric(5,2) not null,
  phase_correlation numeric(4,2) not null default 0.85,
  master_wav_url text not null,
  file_size_bytes bigint not null default 0,
  duration_seconds numeric(8,2) not null default 0,
  sample_rate integer not null default 48000,
  bit_depth integer not null default 24,
  dsp_snapshot jsonb not null default '{}'::jsonb,
  surgical_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 3. Habilitar Row Level Security (RLS)
alter table public.mastering_sessions enable row level security;

create policy "Usuarios pueden leer sesiones de masterización"
  on public.mastering_sessions for select
  using (true);

create policy "Usuarios autenticados pueden insertar sesiones"
  on public.mastering_sessions for insert
  with check (true);
`;

const LOCAL_HISTORY_KEY = 'tandao_mastering_pro_sessions_v1';

function sanitizeStorageFileName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function readLocalSessions(): MasteringSessionRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MasteringSessionRecord[];
  } catch {
    return [];
  }
}

function saveLocalSession(record: MasteringSessionRecord): void {
  try {
    const current = readLocalSessions();
    const next = [record, ...current].slice(0, 25);
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export interface SaveMasterSessionParams {
  wavBlob: Blob;
  trackTitle: string;
  songId?: string | null;
  presetId: string;
  presetName: string;
  intensityPct: number;
  targetLufs: number;
  inputLufs: number;
  outputLufs: number;
  truePeakDbTp: number;
  phaseCorrelation: number;
  durationSeconds: number;
  sampleRate: number;
  dspSnapshot: MasteringDspChain;
  surgicalOverrides: SurgicalOverrides;
}

/**
 * Uploads the 24-bit WAV Master to Supabase Storage ('masters' bucket with automatic fallback to 'audios')
 * and persists the session metadata in 'mastering_sessions' (+ local history cache).
 */
export async function uploadAndSaveMasterSession(
  params: SaveMasterSessionParams
): Promise<MasteringSessionRecord> {
  const ts = Date.now();
  const cleanTitle = sanitizeStorageFileName(
    params.trackTitle.replace(/\.[^.]+$/, '') || 'Studio_Master'
  );
  const fileName = `${ts}_${cleanTitle}_${params.presetId}_24bit_48kHz.wav`;
  const folderPath = params.songId ? `${params.songId}/${fileName}` : `global/${fileName}`;

  let publicWavUrl = '';

  // 1. Try uploading to 'masters' bucket first
  const { error: mastersBucketErr } = await supabase.storage
    .from('masters')
    .upload(folderPath, params.wavBlob, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (!mastersBucketErr) {
    publicWavUrl = supabase.storage.from('masters').getPublicUrl(folderPath)
      .data.publicUrl;
  } else {
    // 2. Fallback to existing 'audios' bucket used by StemStudio
    const fallbackPath = `masters/${folderPath}`;
    const { error: audiosBucketErr } = await supabase.storage
      .from('audios')
      .upload(fallbackPath, params.wavBlob, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (!audiosBucketErr) {
      publicWavUrl = supabase.storage.from('audios').getPublicUrl(fallbackPath)
        .data.publicUrl;
    } else {
      // Create local object URL if offline / unauthenticated
      publicWavUrl = URL.createObjectURL(params.wavBlob);
    }
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;

  const sessionRecord: MasteringSessionRecord = {
    id: crypto.randomUUID ? crypto.randomUUID() : `mst-${ts}`,
    user_id: userId,
    song_id: params.songId ?? null,
    track_title: params.trackTitle,
    preset_id: params.presetId,
    preset_name: params.presetName,
    intensity_pct: params.intensityPct,
    target_lufs: params.targetLufs,
    input_lufs: params.inputLufs,
    output_lufs: params.outputLufs,
    true_peak_dbtp: params.truePeakDbTp,
    phase_correlation: params.phaseCorrelation,
    master_wav_url: publicWavUrl,
    file_size_bytes: params.wavBlob.size,
    duration_seconds: params.durationSeconds,
    sample_rate: params.sampleRate,
    bit_depth: 24,
    dsp_snapshot: params.dspSnapshot,
    surgical_overrides: params.surgicalOverrides,
    created_at: new Date().toISOString(),
  };

  saveLocalSession(sessionRecord);

  // Persist in 'mastering_sessions' table if migrated
  const { data: inserted, error: dbErr } = await supabase
    .from('mastering_sessions')
    .insert([
      {
        user_id: sessionRecord.user_id,
        song_id: sessionRecord.song_id,
        track_title: sessionRecord.track_title,
        preset_id: sessionRecord.preset_id,
        preset_name: sessionRecord.preset_name,
        intensity_pct: sessionRecord.intensity_pct,
        target_lufs: sessionRecord.target_lufs,
        input_lufs: sessionRecord.input_lufs,
        output_lufs: sessionRecord.output_lufs,
        true_peak_dbtp: sessionRecord.true_peak_dbtp,
        phase_correlation: sessionRecord.phase_correlation,
        master_wav_url: sessionRecord.master_wav_url,
        file_size_bytes: sessionRecord.file_size_bytes,
        duration_seconds: sessionRecord.duration_seconds,
        sample_rate: sessionRecord.sample_rate,
        bit_depth: sessionRecord.bit_depth,
        dsp_snapshot: sessionRecord.dsp_snapshot,
        surgical_overrides: sessionRecord.surgical_overrides,
      },
    ])
    .select()
    .single();

  if (!dbErr && inserted) {
    return inserted as MasteringSessionRecord;
  }

  return sessionRecord;
}

export async function fetchMasteringSessionsHistory(
  songId?: string
): Promise<MasteringSessionRecord[]> {
  const localRecords = readLocalSessions();

  try {
    let query = supabase
      .from('mastering_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (songId) {
      query = query.eq('song_id', songId);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data as MasteringSessionRecord[];
    }
  } catch {
    // Fallback to local records
  }

  return songId
    ? localRecords.filter((r) => r.song_id === songId)
    : localRecords;
}

export interface ProjectAudioTrackItem {
  id: string;
  songId: string;
  songTitle: string;
  stemName: string;
  fileUrl: string;
}

/**
 * Loads existing audio tracks/mixes from the user's Tandao Live Hub project ('songs' + 'stems')
 * so they can master any project track in 1 click.
 */
export async function fetchProjectAudioTracksForMastering(): Promise<
  ProjectAudioTrackItem[]
> {
  try {
    const { data: songs } = await supabase
      .from('songs')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(25);

    if (!songs || songs.length === 0) return [];

    const songMap = new Map<string, string>();
    for (const s of songs) {
      songMap.set(s.id, s.title || 'Proyecto sin título');
    }

    const { data: stems } = await supabase
      .from('stems')
      .select('id, song_id, name, file_url')
      .in(
        'song_id',
        songs.map((s) => s.id)
      )
      .order('created_at', { ascending: false })
      .limit(60);

    if (!stems) return [];

    return stems
      .filter((st) => Boolean(st.file_url))
      .map((st) => ({
        id: st.id,
        songId: st.song_id,
        songTitle: songMap.get(st.song_id) || 'Canción',
        stemName: st.name || 'Master / Track',
        fileUrl: st.file_url,
      }));
  } catch {
    return [];
  }
}
