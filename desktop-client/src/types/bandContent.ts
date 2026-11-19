export interface BandMember {
  id: string;
  name: string;
  role: string;
  bio: string;
}

export interface BandProfile {
  band_slug: string;
  band_name: string;
  hero_eyebrow: string;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url: string;
  hero_video_url: string;
  featured_album_id: string | null;
  manifesto_title: string;
  manifesto_body: string;
  spotify_url: string;
  apple_music_url: string;
  youtube_url: string;
  instagram_url: string;
  tiktok_url: string;
  booking_email: string;
  members: BandMember[];
  updated_at?: string;
}

export interface BandTrack {
  id: string;
  album_id: string;
  title: string;
  duration: string;
  audio_url: string;
  track_number: number;
  created_at?: string;
}

export interface BandAlbum {
  id: string;
  title: string;
  artist: string;
  cover_url: string;
  description?: string | null;
  credits?: string | null;
  release_date?: string | null;
  buy_link?: string | null;
  created_at?: string;
  tracks: BandTrack[];
}

export type BandVideoSourceType = 'upload' | 'youtube' | 'vimeo';

export interface BandVideo {
  id: string;
  band_slug: string;
  title: string;
  category: string;
  source_type: BandVideoSourceType;
  video_url: string;
  thumbnail_url: string;
  duration: string;
  description: string;
  is_featured: boolean;
  sort_order: number;
  created_at?: string;
}

export type BandPhotoCategory = 'En Vivo' | 'Estudio' | 'Backstage' | 'Prensa';

export interface BandPhoto {
  id: string;
  band_slug: string;
  title: string;
  caption: string;
  category: string;
  image_url: string;
  sort_order: number;
  created_at?: string;
}

export interface BandEvent {
  id: string;
  band_slug: string;
  event_date: string;
  venue: string;
  city: string;
  event_type: string;
  status: string;
  ticket_url: string;
  notes: string;
  created_at?: string;
}

export interface BandHubPayload {
  profile: BandProfile;
  albums: BandAlbum[];
  videos: BandVideo[];
  photos: BandPhoto[];
  events: BandEvent[];
  missingTables: string[];
}
