-- ============================================================================
-- LA NACIÓN DEL LEÓN · Esquema Supabase para Web Pública y Gestor de Contenido
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Es idempotente (puede ejecutarse varias veces de forma segura).
-- ============================================================================

-- 1. Asegurar tablas existentes de álbumes y pistas (compatibles con AdminCMS)
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

-- 2. Perfil y configuración avanzada de la web pública de la banda
CREATE TABLE IF NOT EXISTS public.band_site_profiles (
  band_slug TEXT PRIMARY KEY,
  band_name TEXT NOT NULL DEFAULT 'La Nación del León',
  hero_eyebrow TEXT NOT NULL DEFAULT 'NUEVO LANZAMIENTO · ROCK EN VIVO',
  hero_title TEXT NOT NULL DEFAULT 'LA NACIÓN DEL LEÓN',
  hero_subtitle TEXT NOT NULL DEFAULT 'Guitarras de alto voltaje, bajos profundos y una descarga de rock directo desde el corazón del escenario.',
  hero_image_url TEXT DEFAULT '',
  hero_video_url TEXT DEFAULT '',
  featured_album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
  manifesto_title TEXT NOT NULL DEFAULT 'EL RUGIDO NO SE NEGOCIA',
  manifesto_body TEXT NOT NULL DEFAULT 'Nacidos entre amplificadores valvulares, sudor de ensayo y noches interminables de ruta. La Nación del León construye himnos hechos para retumbar en vivo.',
  spotify_url TEXT DEFAULT '',
  apple_music_url TEXT DEFAULT '',
  youtube_url TEXT DEFAULT '',
  instagram_url TEXT DEFAULT '',
  tiktok_url TEXT DEFAULT '',
  booking_email TEXT DEFAULT 'booking@lanaciondelleon.com',
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Videos oficiales y sesiones en vivo
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

-- 4. Galería fotográfica de la banda
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

-- 5. Fechas de gira y conciertos
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

-- Índices para consultas rápidas en la web pública
CREATE INDEX IF NOT EXISTS idx_band_videos_slug_order ON public.band_videos(band_slug, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_band_photos_slug_order ON public.band_photos(band_slug, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_band_events_slug_date ON public.band_events(band_slug, event_date ASC);

-- 6. Habilitar Row Level Security (lectura pública, escritura autenticada)
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_site_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read albums" ON public.albums;
CREATE POLICY "Public read albums" ON public.albums FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write albums" ON public.albums;
CREATE POLICY "Auth write albums" ON public.albums FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public read tracks" ON public.tracks;
CREATE POLICY "Public read tracks" ON public.tracks FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write tracks" ON public.tracks;
CREATE POLICY "Auth write tracks" ON public.tracks FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

-- 7. Bucket público dedicado para portadas, audios, videos y fotos (opcional; si no existe se usa 'audios')
INSERT INTO storage.buckets (id, name, public)
VALUES ('band-media', 'band-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read band-media" ON storage.objects;
CREATE POLICY "Public read band-media" ON storage.objects
  FOR SELECT USING (bucket_id = 'band-media');

DROP POLICY IF EXISTS "Auth upload band-media" ON storage.objects;
CREATE POLICY "Auth upload band-media" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'band-media');

DROP POLICY IF EXISTS "Auth update band-media" ON storage.objects;
CREATE POLICY "Auth update band-media" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'band-media');

DROP POLICY IF EXISTS "Auth delete band-media" ON storage.objects;
CREATE POLICY "Auth delete band-media" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'band-media');
