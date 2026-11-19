import { supabase } from '../lib/supabase';
import type {
  BandAlbum,
  BandEvent,
  BandHubPayload,
  BandMember,
  BandPhoto,
  BandProfile,
  BandTrack,
  BandVideo,
  BandVideoSourceType,
} from '../types/bandContent';

export const BAND_SLUG = 'la-nacion-del-leon';

export const DEFAULT_HERO_IMAGE = '/images/nacion-del-leon/hero-stage.jpg';
export const DEFAULT_ALBUM_COVER = '/images/nacion-del-leon/default-cover.jpg';

export const DEFAULT_BAND_MEMBERS: BandMember[] = [
  {
    id: 'm-1',
    name: 'VOZ & GUITARRA',
    role: 'FRENTE DE ESCENARIO',
    bio: 'Guitarras crudas, letras de fuego y energía directa para estadios y recintos en vivo.',
  },
  {
    id: 'm-2',
    name: 'GUITARRA LÍDER',
    role: 'RIFFS & SOLOS',
    bio: 'Amplificadores valvulares al límite, texturas analógicas y líneas melódicas cortantes.',
  },
  {
    id: 'm-3',
    name: 'BAJO ELÉCTRICO',
    role: 'PULSO & GRAVES',
    bio: 'Cimiento sub-grave y pegada contundente que sostiene cada descarga en vivo.',
  },
  {
    id: 'm-4',
    name: 'BATERÍA & LIVE SYNC',
    role: 'RITMO & SECUENCIAS',
    bio: 'Precisión en vivo sincronizada con nuestro motor de escenario TANDU Stage.',
  },
];

export const DEFAULT_BAND_PROFILE: BandProfile = {
  band_slug: BAND_SLUG,
  band_name: 'La Nación del León',
  hero_eyebrow: 'ROCK EN VIVO · CATÁLOGO OFICIAL',
  hero_title: 'LA NACIÓN DEL LEÓN',
  hero_subtitle:
    'Guitarras de alto voltaje, bajos profundos y una descarga de rock directo desde el corazón del escenario.',
  hero_image_url: DEFAULT_HERO_IMAGE,
  hero_video_url: '',
  featured_album_id: null,
  manifesto_title: 'EL RUGIDO NO SE NEGOCIA',
  manifesto_body:
    'Nacidos entre amplificadores valvulares, horas de estudio y noches interminables de ruta. Cada canción está diseñada para retumbar en vivo y conectar sin filtros con la manada.',
  spotify_url: '',
  apple_music_url: '',
  youtube_url: '',
  instagram_url: '',
  tiktok_url: '',
  booking_email: 'booking@lanaciondelleon.com',
  members: DEFAULT_BAND_MEMBERS,
};

export const BAND_CMS_SQL_MIGRATION = `-- Ejecutar en Supabase Dashboard -> SQL Editor -> Run
CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'La Nación del León',
  cover_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  credits TEXT DEFAULT '',
  release_date TEXT DEFAULT '',
  buy_link TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration TEXT DEFAULT '0:00',
  audio_url TEXT DEFAULT '',
  track_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.band_site_profiles (
  band_slug TEXT PRIMARY KEY,
  band_name TEXT NOT NULL DEFAULT 'La Nación del León',
  hero_eyebrow TEXT NOT NULL DEFAULT 'ROCK EN VIVO · CATÁLOGO OFICIAL',
  hero_title TEXT NOT NULL DEFAULT 'LA NACIÓN DEL LEÓN',
  hero_subtitle TEXT NOT NULL DEFAULT 'Guitarras de alto voltaje, bajos profundos y una descarga de rock directo desde el corazón del escenario.',
  hero_image_url TEXT DEFAULT '',
  hero_video_url TEXT DEFAULT '',
  featured_album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
  manifesto_title TEXT NOT NULL DEFAULT 'EL RUGIDO NO SE NEGOCIA',
  manifesto_body TEXT NOT NULL DEFAULT 'Nacidos entre amplificadores valvulares, horas de estudio y noches interminables de ruta.',
  spotify_url TEXT DEFAULT '',
  apple_music_url TEXT DEFAULT '',
  youtube_url TEXT DEFAULT '',
  instagram_url TEXT DEFAULT '',
  tiktok_url TEXT DEFAULT '',
  booking_email TEXT DEFAULT 'booking@lanaciondelleon.com',
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.band_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_slug TEXT NOT NULL DEFAULT 'la-nacion-del-leon',
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'En Vivo',
  source_type TEXT NOT NULL DEFAULT 'youtube' CHECK (source_type IN ('upload', 'youtube', 'vimeo')),
  video_url TEXT NOT NULL,
  thumbnail_url TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  description TEXT DEFAULT '',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.band_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_slug TEXT NOT NULL DEFAULT 'la-nacion-del-leon',
  title TEXT NOT NULL DEFAULT '',
  caption TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'En Vivo',
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.band_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_slug TEXT NOT NULL DEFAULT 'la-nacion-del-leon',
  event_date TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL,
  city TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'ARENA',
  status TEXT NOT NULL DEFAULT 'DISPONIBLE',
  ticket_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.band_site_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read band_site_profiles" ON public.band_site_profiles;
CREATE POLICY "Public read band_site_profiles" ON public.band_site_profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write band_site_profiles" ON public.band_site_profiles;
CREATE POLICY "Auth write band_site_profiles" ON public.band_site_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read band_videos" ON public.band_videos;
CREATE POLICY "Public read band_videos" ON public.band_videos FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write band_videos" ON public.band_videos;
CREATE POLICY "Auth write band_videos" ON public.band_videos FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read band_photos" ON public.band_photos;
CREATE POLICY "Public read band_photos" ON public.band_photos FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write band_photos" ON public.band_photos;
CREATE POLICY "Auth write band_photos" ON public.band_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read band_events" ON public.band_events;
CREATE POLICY "Public read band_events" ON public.band_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write band_events" ON public.band_events;
CREATE POLICY "Auth write band_events" ON public.band_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('band-media', 'band-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read band-media" ON storage.objects;
CREATE POLICY "Public read band-media" ON storage.objects FOR SELECT USING (bucket_id = 'band-media');
DROP POLICY IF EXISTS "Auth upload band-media" ON storage.objects;
CREATE POLICY "Auth upload band-media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'band-media');
DROP POLICY IF EXISTS "Auth update band-media" ON storage.objects;
CREATE POLICY "Auth update band-media" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'band-media');
DROP POLICY IF EXISTS "Auth delete band-media" ON storage.objects;
CREATE POLICY "Auth delete band-media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'band-media');`;

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist') ||
    msg.includes('relation') && msg.includes('not exist')
  );
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function cleanTrackTitleFromFilename(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  return withoutExt
    .replace(/^\d+[\s._-]+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Nueva Pista';
}

export function formatSecondsToMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function detectMediaDuration(file: File, kind: 'audio' | 'video' = 'audio'): Promise<string> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const el = document.createElement(kind);
    let settled = false;

    const finish = (val: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      resolve(val);
    };

    const timer = window.setTimeout(() => finish('0:00'), 3500);

    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(formatSecondsToMMSS(el.duration));
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      finish('0:00');
    };
    el.src = objectUrl;
  });
}

export function extractYouTubeId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const regex of patterns) {
    const match = trimmed.match(regex);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function extractVimeoId(rawUrl: string): string | null {
  const match = rawUrl.trim().match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match?.[1] ?? null;
}

export function detectVideoSourceType(url: string): BandVideoSourceType {
  if (extractYouTubeId(url)) return 'youtube';
  if (extractVimeoId(url)) return 'vimeo';
  return 'upload';
}

export function getEmbedVideoUrl(video: Pick<BandVideo, 'video_url' | 'source_type'>): string | null {
  if (video.source_type === 'youtube') {
    const yt = extractYouTubeId(video.video_url);
    return yt ? `https://www.youtube.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1` : null;
  }
  if (video.source_type === 'vimeo') {
    const vm = extractVimeoId(video.video_url);
    return vm ? `https://player.vimeo.com/video/${vm}?autoplay=1` : null;
  }
  return null;
}

export function getAutoVideoThumbnail(url: string, fallback = DEFAULT_HERO_IMAGE): string {
  const yt = extractYouTubeId(url);
  if (yt) return `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;
  return fallback;
}

/**
 * Uploads any band media file (audio, cover, photo, video) to Supabase Storage.
 * Tries dedicated 'band-media' bucket first, then falls back cleanly to existing 'audios' bucket.
 */
export async function uploadBandMedia(
  file: File,
  folder: 'covers' | 'tracks' | 'videos' | 'photos' | 'hero'
): Promise<{ publicUrl: string; bucket: string; path: string }> {
  const cleanName = sanitizeFileName(file.name) || `media_${Date.now()}`;
  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${cleanName}`;
  const primaryPath = `${BAND_SLUG}/${folder}/${uniqueName}`;
  const fallbackPath = `band-media/${BAND_SLUG}/${folder}/${uniqueName}`;

  const contentType = file.type || undefined;

  const firstAttempt = await supabase.storage
    .from('band-media')
    .upload(primaryPath, file, { contentType, upsert: false });

  if (!firstAttempt.error) {
    const { data } = supabase.storage.from('band-media').getPublicUrl(primaryPath);
    return { publicUrl: data.publicUrl, bucket: 'band-media', path: primaryPath };
  }

  // Fallback to existing public 'audios' bucket used across TANDU Stage
  const fallbackAttempt = await supabase.storage
    .from('audios')
    .upload(fallbackPath, file, { contentType, upsert: false });

  if (fallbackAttempt.error) {
    throw new Error(
      `No se pudo subir "${file.name}" al Storage: ${fallbackAttempt.error.message || firstAttempt.error.message}`
    );
  }

  const { data } = supabase.storage.from('audios').getPublicUrl(fallbackPath);
  return { publicUrl: data.publicUrl, bucket: 'audios', path: fallbackPath };
}

export async function deleteStorageByPublicUrl(publicUrl?: string | null): Promise<void> {
  if (!publicUrl || !publicUrl.includes('/storage/v1/object/public/')) return;
  try {
    const afterMarker = publicUrl.split('/storage/v1/object/public/')[1];
    if (!afterMarker) return;
    const slashIdx = afterMarker.indexOf('/');
    if (slashIdx <= 0) return;
    const bucket = afterMarker.slice(0, slashIdx);
    const objectPath = decodeURIComponent(afterMarker.slice(slashIdx + 1));
    if (!bucket || !objectPath) return;
    await supabase.storage.from(bucket).remove([objectPath]);
  } catch {
    // Non-blocking storage cleanup
  }
}

export async function loadBandHubData(): Promise<BandHubPayload> {
  const missingTables: string[] = [];

  // 1. Load Profile (band_site_profiles -> fallback to site_config -> default)
  let profile: BandProfile = { ...DEFAULT_BAND_PROFILE };
  const { data: profileData, error: profileErr } = await supabase
    .from('band_site_profiles')
    .select('*')
    .eq('band_slug', BAND_SLUG)
    .maybeSingle();

  if (profileErr && isMissingTableError(profileErr)) {
    missingTables.push('band_site_profiles');
    // Graceful fallback to existing site_config table
    const { data: legacyConfig } = await supabase.from('site_config').select('*').limit(1).maybeSingle();
    if (legacyConfig) {
      profile = {
        ...profile,
        hero_title: legacyConfig.hero_title || profile.hero_title,
        hero_eyebrow: legacyConfig.hero_subtitle || profile.hero_eyebrow,
        hero_subtitle: legacyConfig.hero_description || profile.hero_subtitle,
      };
    }
  } else if (profileData) {
    const rawMembers = Array.isArray(profileData.members) && profileData.members.length > 0
      ? (profileData.members as BandMember[])
      : DEFAULT_BAND_MEMBERS;
    profile = {
      ...DEFAULT_BAND_PROFILE,
      ...profileData,
      hero_image_url: profileData.hero_image_url || DEFAULT_HERO_IMAGE,
      members: rawMembers,
    };
  }

  // 2. Load Albums + Tracks (tables already exist in project)
  let albums: BandAlbum[] = [];
  const { data: albumsData, error: albumsErr } = await supabase
    .from('albums')
    .select('*, tracks(*)')
    .order('created_at', { ascending: false });

  if (albumsErr && isMissingTableError(albumsErr)) {
    missingTables.push('albums');
  } else if (albumsData) {
    albums = (albumsData as BandAlbum[]).map((album) => ({
      ...album,
      cover_url: album.cover_url || DEFAULT_ALBUM_COVER,
      tracks: Array.isArray(album.tracks)
        ? [...album.tracks].sort((a, b) => (a.track_number || 0) - (b.track_number || 0))
        : [],
    }));
  }

  // 3. Load Videos
  let videos: BandVideo[] = [];
  const { data: videosData, error: videosErr } = await supabase
    .from('band_videos')
    .select('*')
    .eq('band_slug', BAND_SLUG)
    .order('is_featured', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (videosErr && isMissingTableError(videosErr)) {
    missingTables.push('band_videos');
  } else if (videosData) {
    videos = videosData as BandVideo[];
  }

  // 4. Load Photos
  let photos: BandPhoto[] = [];
  const { data: photosData, error: photosErr } = await supabase
    .from('band_photos')
    .select('*')
    .eq('band_slug', BAND_SLUG)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (photosErr && isMissingTableError(photosErr)) {
    missingTables.push('band_photos');
  } else if (photosData) {
    photos = photosData as BandPhoto[];
  }

  // 5. Load Tour Events
  let events: BandEvent[] = [];
  const { data: eventsData, error: eventsErr } = await supabase
    .from('band_events')
    .select('*')
    .eq('band_slug', BAND_SLUG)
    .order('event_date', { ascending: true });

  if (eventsErr && isMissingTableError(eventsErr)) {
    missingTables.push('band_events');
  } else if (eventsData) {
    events = eventsData as BandEvent[];
  }

  return { profile, albums, videos, photos, events, missingTables };
}

// ============================================================================
// CRUD: PROFILE
// ============================================================================
export async function saveBandProfile(profile: BandProfile): Promise<void> {
  const payload = {
    band_slug: BAND_SLUG,
    band_name: profile.band_name,
    hero_eyebrow: profile.hero_eyebrow,
    hero_title: profile.hero_title,
    hero_subtitle: profile.hero_subtitle,
    hero_image_url: profile.hero_image_url,
    hero_video_url: profile.hero_video_url,
    featured_album_id: profile.featured_album_id || null,
    manifesto_title: profile.manifesto_title,
    manifesto_body: profile.manifesto_body,
    spotify_url: profile.spotify_url,
    apple_music_url: profile.apple_music_url,
    youtube_url: profile.youtube_url,
    instagram_url: profile.instagram_url,
    tiktok_url: profile.tiktok_url,
    booking_email: profile.booking_email,
    members: profile.members,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('band_site_profiles')
    .upsert(payload, { onConflict: 'band_slug' });

  if (error) {
    throw new Error(
      isMissingTableError(error)
        ? 'Falta crear la tabla band_site_profiles. Ejecuta el script SQL desde el botón "SQL Supabase".'
        : error.message
    );
  }
}

// ============================================================================
// CRUD: ALBUMS & TRACKS
// ============================================================================
export async function createBandAlbum(input: {
  title: string;
  artist: string;
  cover_url: string;
  description: string;
  credits: string;
  release_date: string;
  buy_link: string;
}): Promise<BandAlbum> {
  const { data, error } = await supabase
    .from('albums')
    .insert([
      {
        title: input.title.trim(),
        artist: input.artist.trim() || 'La Nación del León',
        cover_url: input.cover_url.trim() || DEFAULT_ALBUM_COVER,
        description: input.description.trim(),
        credits: input.credits.trim(),
        release_date: input.release_date.trim(),
        buy_link: input.buy_link.trim(),
      },
    ])
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Error al crear álbum');
  return { ...(data as BandAlbum), tracks: [] };
}

export async function updateBandAlbum(
  id: string,
  input: Partial<{
    title: string;
    artist: string;
    cover_url: string;
    description: string;
    credits: string;
    release_date: string;
    buy_link: string;
  }>
): Promise<BandAlbum> {
  const { data, error } = await supabase
    .from('albums')
    .update(input)
    .eq('id', id)
    .select('*, tracks(*)')
    .single();

  if (error || !data) throw new Error(error?.message || 'Error al actualizar álbum');
  const album = data as BandAlbum;
  return {
    ...album,
    tracks: Array.isArray(album.tracks)
      ? [...album.tracks].sort((a, b) => a.track_number - b.track_number)
      : [],
  };
}

export async function deleteBandAlbum(album: BandAlbum): Promise<void> {
  for (const track of album.tracks || []) {
    await deleteStorageByPublicUrl(track.audio_url);
  }
  await deleteStorageByPublicUrl(album.cover_url);
  const { error } = await supabase.from('albums').delete().eq('id', album.id);
  if (error) throw new Error(error.message);
}

export async function createBandTrack(input: {
  album_id: string;
  title: string;
  duration: string;
  audio_url: string;
  track_number: number;
}): Promise<BandTrack> {
  const { data, error } = await supabase
    .from('tracks')
    .insert([
      {
        album_id: input.album_id,
        title: input.title.trim(),
        duration: input.duration.trim() || '0:00',
        audio_url: input.audio_url.trim(),
        track_number: input.track_number,
      },
    ])
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Error al agregar pista');
  return data as BandTrack;
}

export async function updateBandTrack(
  id: string,
  input: Partial<Pick<BandTrack, 'title' | 'duration' | 'audio_url' | 'track_number'>>
): Promise<BandTrack> {
  const { data, error } = await supabase
    .from('tracks')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Error al actualizar pista');
  return data as BandTrack;
}

export async function deleteBandTrack(track: BandTrack): Promise<void> {
  await deleteStorageByPublicUrl(track.audio_url);
  const { error } = await supabase.from('tracks').delete().eq('id', track.id);
  if (error) throw new Error(error.message);
}

export async function swapTrackNumbers(a: BandTrack, b: BandTrack): Promise<void> {
  const res1 = await supabase.from('tracks').update({ track_number: b.track_number }).eq('id', a.id);
  if (res1.error) throw new Error(res1.error.message);
  const res2 = await supabase.from('tracks').update({ track_number: a.track_number }).eq('id', b.id);
  if (res2.error) throw new Error(res2.error.message);
}

// ============================================================================
// CRUD: VIDEOS
// ============================================================================
export async function createBandVideo(input: {
  title: string;
  category: string;
  source_type: BandVideoSourceType;
  video_url: string;
  thumbnail_url: string;
  duration: string;
  description: string;
  is_featured: boolean;
  sort_order: number;
}): Promise<BandVideo> {
  if (input.is_featured) {
    await supabase
      .from('band_videos')
      .update({ is_featured: false })
      .eq('band_slug', BAND_SLUG);
  }

  const { data, error } = await supabase
    .from('band_videos')
    .insert([{ ...input, band_slug: BAND_SLUG }])
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      isMissingTableError(error)
        ? 'Falta crear la tabla band_videos en Supabase. Copia y ejecuta el SQL desde el botón superior.'
        : error?.message || 'Error al guardar video'
    );
  }
  return data as BandVideo;
}

export async function setFeaturedBandVideo(videoId: string): Promise<void> {
  await supabase.from('band_videos').update({ is_featured: false }).eq('band_slug', BAND_SLUG);
  const { error } = await supabase.from('band_videos').update({ is_featured: true }).eq('id', videoId);
  if (error) throw new Error(error.message);
}

export async function deleteBandVideo(video: BandVideo): Promise<void> {
  if (video.source_type === 'upload') {
    await deleteStorageByPublicUrl(video.video_url);
  }
  await deleteStorageByPublicUrl(video.thumbnail_url);
  const { error } = await supabase.from('band_videos').delete().eq('id', video.id);
  if (error) throw new Error(error.message);
}

// ============================================================================
// CRUD: PHOTOS
// ============================================================================
export async function createBandPhoto(input: {
  title: string;
  caption: string;
  category: string;
  image_url: string;
  sort_order: number;
}): Promise<BandPhoto> {
  const { data, error } = await supabase
    .from('band_photos')
    .insert([{ ...input, band_slug: BAND_SLUG }])
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      isMissingTableError(error)
        ? 'Falta crear la tabla band_photos en Supabase. Copia y ejecuta el SQL desde el botón superior.'
        : error?.message || 'Error al guardar foto'
    );
  }
  return data as BandPhoto;
}

export async function updateBandPhoto(
  id: string,
  input: Partial<Pick<BandPhoto, 'title' | 'caption' | 'category' | 'sort_order'>>
): Promise<BandPhoto> {
  const { data, error } = await supabase
    .from('band_photos')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || 'Error al actualizar foto');
  return data as BandPhoto;
}

export async function deleteBandPhoto(photo: BandPhoto): Promise<void> {
  await deleteStorageByPublicUrl(photo.image_url);
  const { error } = await supabase.from('band_photos').delete().eq('id', photo.id);
  if (error) throw new Error(error.message);
}

// ============================================================================
// CRUD: TOUR EVENTS
// ============================================================================
export async function createBandEvent(input: {
  event_date: string;
  venue: string;
  city: string;
  event_type: string;
  status: string;
  ticket_url: string;
  notes: string;
}): Promise<BandEvent> {
  const { data, error } = await supabase
    .from('band_events')
    .insert([{ ...input, band_slug: BAND_SLUG }])
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      isMissingTableError(error)
        ? 'Falta crear la tabla band_events en Supabase. Copia y ejecuta el SQL desde el botón superior.'
        : error?.message || 'Error al guardar evento'
    );
  }
  return data as BandEvent;
}

export async function deleteBandEvent(id: string): Promise<void> {
  const { error } = await supabase.from('band_events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
