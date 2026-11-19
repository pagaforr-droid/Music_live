import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ArrowUpRight,
  X,
  ChevronLeft,
  ChevronRight,
  Menu,
  Disc3,
  Film,
  Camera,
  Calendar,
  Loader2,
  Settings2,
  ArrowUp,
  Mail,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_ALBUM_COVER,
  DEFAULT_BAND_PROFILE,
  DEFAULT_HERO_IMAGE,
  formatSecondsToMMSS,
  getAutoVideoThumbnail,
  getEmbedVideoUrl,
  loadBandHubData,
} from '../services/bandContentService';
import { useBandAudioPlayer } from '../hooks/useBandAudioPlayer';
import type { BandAlbum, BandEvent, BandPhoto, BandProfile, BandVideo } from '../types/bandContent';
import '../styles/laNacionDelLeon.css';

const SPRING_UI = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.9 };
const EASE_EDITORIAL = [0.2, 0.7, 0.2, 1] as const;

const LionCrestMark: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <polygon
      points="24,2 42,12 45,30 34,44 14,44 3,30 6,12"
      fill="#100c0a"
      stroke="#ff5412"
      strokeWidth="2.1"
    />
    <path
      d="M14 20 L19 13 L24 18 L29 13 L34 20 L31 32 L24 37 L17 32 Z"
      fill="none"
      stroke="#f4efe6"
      strokeWidth="1.9"
    />
    <polygon points="24,21 28,28 24,33 20,28" fill="#ff5412" />
  </svg>
);

const EqBars: React.FC<{ active: boolean; className?: string }> = ({ active, className = '' }) => (
  <span className={`inline-flex items-end gap-[2px] h-3.5 w-3.5 justify-center ${className}`} aria-hidden="true">
    <span className={`w-[3px] bg-current transition-all ${active ? 'animate-eq-1' : 'h-[4px]'}`} />
    <span className={`w-[3px] bg-current transition-all ${active ? 'animate-eq-2' : 'h-[9px]'}`} />
    <span className={`w-[3px] bg-current transition-all ${active ? 'animate-eq-3' : 'h-[6px]'}`} />
  </span>
);

function parseDateParts(iso: string): { day: string; month: string; year: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { day: '--', month: '---', year: '2026', time: '' };
  }
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: months[d.getMonth()] || '---',
    year: String(d.getFullYear()),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}h`,
  };
}

export default function LaNacionDelLeon() {
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<BandProfile>(DEFAULT_BAND_PROFILE);
  const [albums, setAlbums] = useState<BandAlbum[]>([]);
  const [videos, setVideos] = useState<BandVideo[]>([]);
  const [photos, setPhotos] = useState<BandPhoto[]>([]);
  const [events, setEvents] = useState<BandEvent[]>([]);

  // Interactive UI states
  const [isScrolled, setIsScrolled] = useState(false);
  const [showFloatingPlayer, setShowFloatingPlayer] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedVideoModal, setSelectedVideoModal] = useState<BandVideo | null>(null);
  const [photoFilter, setPhotoFilter] = useState<string>('TODAS');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Set page document title for public visitors
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${profile.band_name || 'La Nación del León'} · Web Oficial`;
    return () => {
      document.title = prevTitle;
    };
  }, [profile.band_name]);

  // Fetch all real band content from Supabase
  useEffect(() => {
    let active = true;
    loadBandHubData()
      .then((data) => {
        if (!active) return;
        setProfile(data.profile);
        setAlbums(data.albums);
        setVideos(data.videos);
        setPhotos(data.photos);
        setEvents(data.events);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Resolve initial/featured album
  const featuredAlbum = useMemo<BandAlbum | null>(() => {
    if (albums.length === 0) return null;
    if (profile.featured_album_id) {
      const found = albums.find((a) => a.id === profile.featured_album_id);
      if (found) return found;
    }
    return albums[0];
  }, [albums, profile.featured_album_id]);

  const player = useBandAudioPlayer(featuredAlbum);

  // Update scroll flags for sticky masthead & floating mini-player
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setIsScrolled(y > 24);
      setShowFloatingPlayer(y > 540);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Countdown tick every second for the next upcoming concert
  const nextShow = useMemo<BandEvent | null>(() => {
    if (events.length === 0) return null;
    const now = Date.now();
    const upcoming = events.find((ev) => new Date(ev.event_date).getTime() > now);
    return upcoming || events[0];
  }, [events]);

  useEffect(() => {
    if (!nextShow) return;
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextShow]);

  const countdown = useMemo(() => {
    if (!nextShow) return null;
    const diff = Math.max(0, new Date(nextShow.event_date).getTime() - countdownNow);
    const totalSec = Math.floor(diff / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return {
      days: String(days).padStart(2, '0'),
      hours: String(hours).padStart(2, '0'),
      mins: String(mins).padStart(2, '0'),
      secs: String(secs).padStart(2, '0'),
    };
  }, [nextShow, countdownNow]);

  // Filtered photo gallery + keyboard navigation inside Lightbox
  const photoCategories = useMemo(() => {
    const cats = Array.from(new Set(photos.map((p) => (p.category || 'En Vivo').toUpperCase())));
    return ['TODAS', ...cats];
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    if (photoFilter === 'TODAS') return photos;
    return photos.filter((p) => (p.category || 'En Vivo').toUpperCase() === photoFilter);
  }, [photos, photoFilter]);

  useEffect(() => {
    if (lightboxIndex === null && !selectedVideoModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
        setSelectedVideoModal(null);
      } else if (lightboxIndex !== null && filteredPhotos.length > 0) {
        if (e.key === 'ArrowRight') {
          setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % filteredPhotos.length));
        } else if (e.key === 'ArrowLeft') {
          setLightboxIndex((prev) =>
            prev === null ? 0 : (prev - 1 + filteredPhotos.length) % filteredPhotos.length
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, selectedVideoModal, filteredPhotos.length]);

  // Reactive Circular Equalizer Canvas (Template #77217 signature, driven by real FFT audio)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let phase = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        ctx.clearRect(0, 0, w, h);

        const cx = w >= 1024 ? w * 0.67 : w * 0.5;
        const cy = h * 0.48;
        const baseR = Math.min(w, h) * 0.25;
        const bars = 88;
        phase += player.isPlaying ? 0.048 : 0.011;

        const bins = player.sampleFrequencyBins(bars, phase);

        // Subtle outer & inner precision rings
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.strokeStyle = player.isPlaying ? 'rgba(255, 84, 18, 0.32)' : 'rgba(255, 84, 18, 0.14)';
        ctx.lineWidth = 1.25;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 0.84, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(244, 239, 230, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Radial audio spectrum spikes
        for (let i = 0; i < bars; i++) {
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const energy = bins[i] || 0;
          const spikeLen = player.isPlaying ? 8 + energy * 62 : 4 + energy * 14;

          const x1 = cx + Math.cos(angle) * (baseR + 4);
          const y1 = cy + Math.sin(angle) * (baseR + 4);
          const x2 = cx + Math.cos(angle) * (baseR + 4 + spikeLen);
          const y2 = cy + Math.sin(angle) * (baseR + 4 + spikeLen);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle =
            i % 4 === 0
              ? `rgba(255, 170, 59, ${player.isPlaying ? 0.65 : 0.28})`
              : `rgba(255, 84, 18, ${player.isPlaying ? 0.52 : 0.22})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [player.isPlaying, player.sampleFrequencyBins]);

  const openVideoModal = (video: BandVideo) => {
    player.pause();
    setSelectedVideoModal(video);
  };

  const featuredVideo = useMemo<BandVideo | null>(() => {
    if (videos.length === 0) return null;
    return videos.find((v) => v.is_featured) || videos[0];
  }, [videos]);

  const secondaryVideos = useMemo(() => {
    if (!featuredVideo) return [];
    return videos.filter((v) => v.id !== featuredVideo.id);
  }, [videos, featuredVideo]);

  const progressPct = player.duration > 0 ? Math.min(100, (player.currentTime / player.duration) * 100) : 0;

  const tickerItems = useMemo(() => {
    if (events.length > 0) {
      return events.map((ev) => {
        const dp = parseDateParts(ev.event_date);
        return `${dp.day} ${dp.month} · ${ev.city.toUpperCase()} — ${ev.venue.toUpperCase()}`;
      });
    }
    return [
      `${profile.band_name.toUpperCase()} · ROCK EN VIVO`,
      'NUEVA MÚSICA EN STREAMING DIRECTO',
      'VIDEOS EN 4K & SESIONES DE ESTUDIO',
      `BOOKING · ${profile.booking_email.toUpperCase()}`,
    ];
  }, [events, profile.band_name, profile.booking_email]);

  const heroImage = profile.hero_image_url || DEFAULT_HERO_IMAGE;
  const activeCover = player.activeAlbum?.cover_url || featuredAlbum?.cover_url || DEFAULT_ALBUM_COVER;

  const navItems = [
    { href: '#musica', label: 'Música' },
    { href: '#videos', label: 'Videos' },
    { href: '#fotos', label: 'Fotos' },
    { href: '#gira', label: 'Gira' },
    { href: '#banda', label: 'La Banda' },
    { href: '#contacto', label: 'Booking' },
  ];

  return (
    <div id="top" className="lion-root relative w-full overflow-x-hidden">
      {/* =====================================================================
          1. FIXED EDITORIAL MASTHEAD (jeremycamp.com + Template #77217)
         ===================================================================== */}
      <header
        className="fixed inset-x-0 top-0 z-50 transition-colors duration-200 border-b backdrop-blur-md"
        style={{
          backgroundColor: isScrolled ? 'rgba(6, 5, 5, 0.96)' : 'rgba(6, 5, 5, 0.78)',
          borderBottomColor: isScrolled ? 'rgba(244, 239, 230, 0.14)' : 'rgba(244, 239, 230, 0.06)',
        }}
      >
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 lg:px-12 h-[76px] flex items-center justify-between gap-6">
          {/* Brand Crest + Anton Lockup */}
          <a href="#top" className="flex items-center gap-3.5 group shrink-0">
            <LionCrestMark className="w-10 h-10 transition-transform duration-200 group-hover:scale-105" />
            <div className="flex flex-col leading-none">
              <span className="lion-display text-2xl sm:text-[1.7rem] text-[#f4efe6] group-hover:text-[#ff5412] transition-colors">
                {profile.band_name}
              </span>
              <span className="lion-label text-[11px] text-[#b3a89a] tracking-[0.2em] mt-0.5">
                ROCK · SITIO OFICIAL
              </span>
            </div>
          </a>

          {/* Center Navigation */}
          <nav className="hidden lg:flex items-center gap-8" aria-label="Navegación principal">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="lion-nav-link lion-label text-[13px]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Right Controls: Live Player Trigger + CMS Link + Mobile Drawer */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (player.activeTrack) {
                  player.togglePlay();
                } else {
                  document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className={`hidden sm:inline-flex items-center gap-2.5 px-4 py-2.5 border transition-colors cursor-pointer ${
                player.isPlaying
                  ? 'border-[#ff5412] bg-[#ff5412] text-[#060505]'
                  : 'border-[rgba(255,84,18,0.45)] bg-[#ff5412]/10 text-[#f4efe6] hover:bg-[#ff5412] hover:text-[#060505]'
              }`}
              title={player.activeTrack ? `Reproducir ${player.activeTrack.title}` : 'Ir a discografía'}
            >
              <EqBars active={player.isPlaying} />
              <span className="lion-label text-xs">
                {player.isPlaying ? 'Sonando' : 'Escuchar'}
              </span>
            </button>

            <Link
              to={session ? '/nacion-cms' : '/login'}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2.5 border border-[rgba(244,239,230,0.16)] hover:border-[#ff5412] text-[#b3a89a] hover:text-[#f4efe6] transition-colors lion-label text-[11px]"
              title="Administrar música, videos y fotos"
            >
              <Settings2 size={14} />
              <span>CMS</span>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-11 h-11 border border-[rgba(244,239,230,0.2)] text-[#f4efe6] hover:border-[#ff5412] cursor-pointer"
              aria-label="Abrir menú"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] bg-[#060505]/95 backdrop-blur-xl flex flex-col justify-between p-6"
          >
            <div className="flex items-center justify-between border-b border-[rgba(244,239,230,0.14)] pb-5">
              <div className="flex items-center gap-3">
                <LionCrestMark className="w-9 h-9" />
                <span className="lion-display text-2xl text-[#f4efe6]">{profile.band_name}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="w-11 h-11 border border-[rgba(244,239,230,0.2)] flex items-center justify-center text-[#f4efe6]"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex flex-col gap-3 my-auto">
              {navItems.map((item, idx) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...SPRING_UI, delay: idx * 0.04 }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="lion-display text-4xl text-[#f4efe6] hover:text-[#ff5412] py-1.5 border-b border-[rgba(244,239,230,0.08)]"
                >
                  {item.label}
                </motion.a>
              ))}
            </nav>

            <div className="flex items-center justify-between pt-4 border-t border-[rgba(244,239,230,0.14)]">
              <Link
                to={session ? '/nacion-cms' : '/login'}
                onClick={() => setMobileMenuOpen(false)}
                className="lion-label text-xs text-[#ff5412] inline-flex items-center gap-2"
              >
                <Settings2 size={15} />
                <span>GESTOR DE CONTENIDO</span>
              </Link>
              <span className="lion-label text-xs text-[#72675d]">© 2026</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          2. HERO SECTION (Layered Anton + Ember Light Leak + Audio Deck + Canvas EQ)
         ===================================================================== */}
      <section className="relative min-h-[100svh] flex flex-col justify-between pt-[84px] overflow-hidden border-b border-[rgba(244,239,230,0.14)]">
        {/* Background Media Layer */}
        <div className="absolute inset-0 z-0 overflow-hidden bg-[#060505]">
          {profile.hero_video_url ? (
            <video
              src={profile.hero_video_url}
              poster={heroImage}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover object-center opacity-85"
            />
          ) : (
            <img
              src={heroImage}
              alt={profile.band_name}
              className="w-full h-full object-cover object-[72%_25%] sm:object-center scale-[1.01]"
            />
          )}

          {/* Directional editorial scrim & warm ember light leak (jeremycamp.com signature) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(6,5,5,0.58) 0%, rgba(6,5,5,0.18) 38%, rgba(6,5,5,0.78) 76%, rgba(6,5,5,0.98) 100%), linear-gradient(90deg, rgba(6,5,5,0.92) 0%, rgba(6,5,5,0.56) 44%, rgba(6,5,5,0.08) 76%), radial-gradient(48% 58% at 96% 42%, rgba(255,84,18,0.28) 0%, transparent 72%)',
            }}
          />

          {/* Subtle analog 35mm film grain */}
          <div className="lion-grain absolute inset-0" />

          {/* Live Reactive Circular Equalizer Canvas (Template #77217) */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none opacity-80"
          />
        </div>

        {/* HERO TOP AUDIO DECK (Template #77217 jp-creative signature bar) */}
        <div className="relative z-10 max-w-[1380px] mx-auto w-full px-5 sm:px-8 lg:px-12 pt-4">
          <div className="bg-[#0d0b0a]/82 backdrop-blur-md border border-[rgba(244,239,230,0.14)] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            {/* Transport controls */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={player.prevTrack}
                disabled={!player.activeTrack}
                className="text-[#b3a89a] hover:text-[#ff5412] disabled:opacity-30 p-1.5 transition-colors cursor-pointer"
                aria-label="Pista anterior"
              >
                <SkipBack size={17} />
              </button>

              <button
                type="button"
                onClick={player.togglePlay}
                disabled={!player.activeTrack}
                className="w-10 h-10 bg-[#ff5412] hover:bg-[#ffaa3b] disabled:bg-[#2a231f] disabled:text-[#72675d] text-[#060505] flex items-center justify-center transition-colors cursor-pointer"
                aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
              >
                {player.isBuffering ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : player.isPlaying ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" className="ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={player.nextTrack}
                disabled={!player.activeTrack}
                className="text-[#b3a89a] hover:text-[#ff5412] disabled:opacity-30 p-1.5 transition-colors cursor-pointer"
                aria-label="Siguiente pista"
              >
                <SkipForward size={17} />
              </button>

              <div className="pl-3 border-l border-[rgba(244,239,230,0.14)] min-w-0 flex-1 sm:flex-initial">
                <div className="lion-label text-[11px] text-[#ff5412] whitespace-nowrap">
                  {player.isPlaying ? 'REPRODUCIENDO AHORA' : 'REPRODUCTOR OFICIAL'}
                </div>
                <div className="lion-display !leading-[1.12] text-base sm:text-xl text-[#f4efe6] truncate max-w-[190px] sm:max-w-[280px] whitespace-nowrap">
                  {player.activeTrack
                    ? `${String(player.activeTrackIndex + 1).padStart(2, '0')}. ${player.activeTrack.title}`
                    : loading
                      ? 'CARGANDO CATÁLOGO...'
                      : 'SUBE TU MÚSICA EN CMS'}
                </div>
              </div>
            </div>

            {/* Scrubber Rail */}
            <div className="flex-1 min-w-[180px] flex items-center gap-3">
              <span className="text-xs text-[#b3a89a] tnum w-10 text-right">
                {formatSecondsToMMSS(player.currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(player.duration, 1)}
                step={0.5}
                value={Math.min(player.currentTime, Math.max(player.duration, 1))}
                onChange={(e) => player.seek(Number(e.target.value))}
                disabled={!player.activeTrack}
                className="lion-scrubber flex-1"
                aria-label="Línea de tiempo"
              />
              <span className="text-xs text-[#b3a89a] tnum w-10">
                {player.duration > 0
                  ? formatSecondsToMMSS(player.duration)
                  : player.activeTrack?.duration || '0:00'}
              </span>
            </div>

            {/* Volume + Album Badge */}
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={player.toggleMute}
                  className="text-[#b3a89a] hover:text-[#f4efe6] cursor-pointer"
                  aria-label="Silenciar"
                >
                  {player.isMuted || player.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={player.isMuted ? 0 : player.volume}
                  onChange={(e) => player.setVolume(Number(e.target.value))}
                  className="lion-scrubber w-20"
                  aria-label="Volumen"
                />
              </div>
              {player.activeAlbum && (
                <span className="lion-label text-[11px] px-2.5 py-1 bg-[#f4efe6]/8 text-[#ffaa3b] truncate max-w-[150px]">
                  {player.activeAlbum.title}
                </span>
              )}
            </div>
          </div>
          {player.error && (
            <div className="mt-2 px-4 py-2 bg-[#ff5412]/15 border border-[#ff5412]/40 text-xs text-[#ffaa3b]">
              {player.error}
            </div>
          )}
        </div>

        {/* HERO EDITORIAL LOCKUP (jeremycamp.com monumental Anton layout) */}
        <div className="relative z-10 max-w-[1380px] mx-auto w-full px-5 sm:px-8 lg:px-12 py-10 lg:py-14 flex flex-col gap-10">
          <motion.div
            initial={{ opacity: 0.92, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: EASE_EDITORIAL }}
            className="max-w-4xl"
          >
            <div className="lion-label text-xs sm:text-sm text-[#ff7324] mb-3 flex items-center gap-3">
              <span className="w-10 h-[2px] bg-[#ff5412] inline-block" />
              <span>{profile.hero_eyebrow}</span>
            </div>
            <h1 className="lion-display-xl text-[#f4efe6] drop-shadow-[0_12px_36px_rgba(0,0,0,0.65)]">
              {profile.hero_title}
            </h1>
            <p className="lion-lead max-w-xl mt-5 text-[#d4cbc0]">
              {profile.hero_subtitle}
            </p>
          </motion.div>

          {/* Bottom Row: Featured Release + Next Show Countdown */}
          <motion.div
            initial={{ opacity: 0.92, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: 0.04, ease: EASE_EDITORIAL }}
            className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 pt-2"
          >
            {/* Release Block */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <button
                type="button"
                onClick={() => {
                  if (featuredAlbum && featuredAlbum.tracks.length > 0) {
                    player.playTrack(featuredAlbum, 0);
                  } else {
                    document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="w-28 h-28 sm:w-36 sm:h-36 shrink-0 border border-[rgba(255,84,18,0.45)] overflow-hidden bg-[#110e0c] shadow-[0_24px_48px_rgba(0,0,0,0.8)] group relative cursor-pointer"
                aria-label="Reproducir lanzamiento destacado"
              >
                <img
                  src={activeCover}
                  alt={featuredAlbum?.title || profile.band_name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="w-11 h-11 bg-[#ff5412] text-[#060505] flex items-center justify-center">
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  </span>
                </span>
              </button>

              <div className="space-y-3">
                <div>
                  <div className="lion-label text-xs text-[#ffaa3b]">
                    {featuredAlbum ? `ÁLBUM DESTACADO ${featuredAlbum.release_date ? `· ${featuredAlbum.release_date}` : ''}` : 'CATÁLOGO OFICIAL'}
                  </div>
                  <div className="lion-display text-3xl text-[#f4efe6] mt-0.5">
                    {featuredAlbum ? featuredAlbum.title : 'DISCOGRAFÍA EN VIVO'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (player.activeTrack) {
                        player.togglePlay();
                      } else if (featuredAlbum && featuredAlbum.tracks.length > 0) {
                        player.playTrack(featuredAlbum, 0);
                      } else {
                        document.getElementById('musica')?.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                    className="lion-btn-ember lion-label text-xs sm:text-sm"
                  >
                    <span>{player.isPlaying ? 'PAUSAR MÚSICA' : 'ESCUCHAR AHORA'}</span>
                    {player.isPlaying ? (
                      <Pause size={16} fill="currentColor" />
                    ) : (
                      <Play size={16} fill="currentColor" />
                    )}
                  </button>
                  <a
                    href="#musica"
                    className="lion-label text-xs text-[#f4efe6] underline decoration-[#ff5412] decoration-2 underline-offset-8 hover:text-[#ff5412] transition-colors py-2"
                  >
                    VER DISCOGRAFÍA
                  </a>
                </div>
              </div>
            </div>

            {/* Next Show Countdown (jeremycamp.com ho-next pattern) */}
            {nextShow ? (
              <div className="border-l-2 border-[#ff5412] pl-5 space-y-1.5">
                <div className="lion-label text-xs text-[#b3a89a]">PRÓXIMO SHOW</div>
                <a
                  href={nextShow.ticket_url || '#gira'}
                  target={nextShow.ticket_url ? '_blank' : undefined}
                  rel={nextShow.ticket_url ? 'noreferrer' : undefined}
                  className="flex flex-wrap items-baseline gap-3 group"
                >
                  <span className="lion-display text-3xl text-[#ff5412]">
                    {parseDateParts(nextShow.event_date).day} {parseDateParts(nextShow.event_date).month}
                  </span>
                  <span className="lion-display text-3xl text-[#f4efe6] group-hover:underline decoration-[#ff5412] underline-offset-4">
                    {nextShow.city}
                  </span>
                </a>
                {countdown && (
                  <div className="flex flex-wrap items-center gap-4 lion-label text-xs text-[#b3a89a] tnum">
                    <span>
                      <b className="text-[#f4efe6] text-sm mr-1">{countdown.days}</b>DÍAS
                    </span>
                    <span>
                      <b className="text-[#f4efe6] text-sm mr-1">{countdown.hours}</b>HRS
                    </span>
                    <span>
                      <b className="text-[#f4efe6] text-sm mr-1">{countdown.mins}</b>MIN
                    </span>
                    <span>
                      <b className="text-[#ff5412] text-sm mr-1">{countdown.secs}</b>SEG
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-l-2 border-[#ff5412] pl-5 space-y-1">
                <div className="lion-label text-xs text-[#b3a89a]">CONTRATACIONES &amp; GIRA</div>
                <a
                  href={`mailto:${profile.booking_email}`}
                  className="lion-display text-2xl sm:text-3xl text-[#f4efe6] hover:text-[#ff5412] transition-colors inline-flex items-center gap-2"
                >
                  <span>FECHAS DISPONIBLES 2026</span>
                  <ArrowUpRight size={22} className="text-[#ff5412]" />
                </a>
              </div>
            )}
          </motion.div>
        </div>

        {/* HIGH-CONTRAST ON TOUR TICKER STRIP (jeremycamp.com signature) */}
        <div className="relative z-10 h-12 bg-[#ff5412] text-[#060505] flex items-center overflow-hidden border-t border-[#ffaa3b]/60">
          <div className="bg-[#060505] text-[#ff5412] lion-label text-xs px-5 sm:px-7 h-full flex items-center shrink-0 z-10 border-r border-[#ff5412] whitespace-nowrap">
            EN GIRA
          </div>
          <div className="lion-ticker-wrap flex-1 min-w-0 overflow-hidden flex items-center h-full">
            <div className="lion-ticker-track text-lg sm:text-xl">
              {[...tickerItems, ...tickerItems].map((text, idx) => (
                <span key={idx} className="lion-ticker-item">
                  <span className="px-6 whitespace-nowrap">{text}</span>
                  <span className="text-[#060505]/50 shrink-0">✦</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. DISCOGRAFÍA Y REPRODUCTOR EDITORIAL (Real Supabase Albums & Audio)
         ===================================================================== */}
      <section
        id="musica"
        className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#0b0908] border-b border-[rgba(244,239,230,0.14)]"
      >
        <div className="max-w-[1380px] mx-auto">
          {/* Header + Album Selector */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-[rgba(244,239,230,0.14)] mb-14">
            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-2">DISCOGRAFÍA OFICIAL · AUDIO DIRECTO</div>
              <h2 className="lion-display-l text-[#f4efe6]">ESCUCHA A LA MANADA</h2>
            </div>

            {albums.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {albums.map((album) => {
                  const isSelected = player.activeAlbum?.id === album.id;
                  return (
                    <button
                      key={album.id}
                      type="button"
                      onClick={() => player.selectAlbum(album, false)}
                      className={`relative px-4 py-2.5 lion-label text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'text-[#060505]'
                          : 'border border-[rgba(244,239,230,0.18)] text-[#b3a89a] hover:text-[#f4efe6] hover:border-[#ff5412]'
                      }`}
                    >
                      {isSelected && (
                        <motion.span
                          layoutId="active-album-pill"
                          transition={SPRING_UI}
                          className="absolute inset-0 bg-[#ff5412]"
                        />
                      )}
                      <span className="relative z-10">
                        {album.release_date ? `${album.release_date} · ` : ''}
                        {album.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {loading ? (
            <div className="py-20 flex items-center justify-center gap-3 text-[#b3a89a] lion-label text-xs">
              <Loader2 size={18} className="animate-spin text-[#ff5412]" />
              <span>CARGANDO DISCOGRAFÍA...</span>
            </div>
          ) : !player.activeAlbum ? (
            <div className="py-16 border border-dashed border-[rgba(244,239,230,0.18)] px-6 text-center space-y-5">
              <Disc3 size={40} className="mx-auto text-[#ff5412]/70" />
              <div className="space-y-2">
                <h3 className="lion-display text-3xl text-[#f4efe6]">AÚN NO HAY ÁLBUMES PUBLICADOS</h3>
                <p className="lion-body max-w-md mx-auto">
                  Sube tus álbumes reales, portadas y archivos de audio (MP3 / WAV / FLAC) desde el gestor de contenido exclusivo.
                </p>
              </div>
              <Link to={session ? '/nacion-cms' : '/login'} className="lion-btn-ember lion-label text-xs">
                <span>IR AL GESTOR DE CONTENIDO</span>
                <ArrowUpRight size={16} />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
              {/* Left Column: Vinyl Sleeve + Metadata */}
              <div className="lg:col-span-5 space-y-8">
                <div
                  className="lion-vinyl-wrap w-60 h-60 sm:w-72 sm:h-72 lg:w-80 lg:h-80"
                  data-playing={player.isPlaying ? 'true' : 'false'}
                >
                  {/* Protruding Spinning Vinyl Record */}
                  <div className="lion-vinyl-disc flex items-center justify-center">
                    <div className="lion-vinyl-rotor w-full h-full rounded-full flex items-center justify-center relative">
                      <div
                        className="w-[34%] h-[34%] rounded-full border-4 border-[#060505] bg-cover bg-center overflow-hidden shadow-inner"
                        style={{
                          backgroundImage: `url(${player.activeAlbum.cover_url || DEFAULT_ALBUM_COVER})`,
                        }}
                      />
                      <div className="w-3 h-3 rounded-full bg-[#060505] border border-[#ff5412]/60 absolute" />
                    </div>
                  </div>

                  {/* Album Cover Sleeve */}
                  <div className="relative z-10 w-full h-full bg-[#15110e] border border-[rgba(255,84,18,0.45)] shadow-[0_28px_60px_rgba(0,0,0,0.88)] overflow-hidden">
                    <img
                      src={player.activeAlbum.cover_url || DEFAULT_ALBUM_COVER}
                      alt={player.activeAlbum.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="lion-label text-xs text-[#ff5412]">
                      {player.activeAlbum.artist}
                      {player.activeAlbum.release_date ? ` · ${player.activeAlbum.release_date}` : ''}
                    </div>
                    <h3 className="lion-display text-4xl sm:text-5xl text-[#f4efe6] mt-1">
                      {player.activeAlbum.title}
                    </h3>
                  </div>

                  {player.activeAlbum.description && (
                    <p className="lion-body max-w-md">{player.activeAlbum.description}</p>
                  )}

                  {player.activeAlbum.credits && (
                    <div className="border-l-2 border-[#ff5412] pl-4 text-sm text-[#b3a89a]">
                      {player.activeAlbum.credits}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 pt-2">
                    {player.activeAlbum.buy_link && (
                      <a
                        href={player.activeAlbum.buy_link}
                        target="_blank"
                        rel="noreferrer"
                        className="lion-btn-wire lion-label text-xs"
                      >
                        <span>STREAM / COMPRAR</span>
                        <ArrowUpRight size={15} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (player.activeAlbum && player.activeAlbum.tracks.length > 0) {
                          player.playTrack(player.activeAlbum, player.activeTrackIndex);
                        }
                      }}
                      disabled={player.activeAlbum.tracks.length === 0}
                      className="lion-btn-ember lion-label text-xs"
                    >
                      {player.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                      <span>{player.isPlaying ? 'PAUSAR' : 'REPRODUCIR ÁLBUM'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Editorial Master Scrubber + Tracklist */}
              <div className="lg:col-span-7">
                {/* Active Track Console Header */}
                <div className="pb-6 border-b border-[rgba(244,239,230,0.16)] space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="lion-label text-xs text-[#ff5412]">
                        PISTA ACTIVA · {player.activeAlbum.tracks.length} CANCIÓN(ES)
                      </div>
                      <div className="lion-display text-3xl sm:text-4xl text-[#f4efe6] truncate mt-0.5">
                        {player.activeTrack
                          ? `${String(player.activeTrackIndex + 1).padStart(2, '0')}. ${player.activeTrack.title}`
                          : 'SIN PISTAS CARGADAS'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={player.prevTrack}
                        disabled={!player.activeTrack}
                        className="w-11 h-11 border border-[rgba(244,239,230,0.2)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
                        aria-label="Anterior"
                      >
                        <SkipBack size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={player.togglePlay}
                        disabled={!player.activeTrack}
                        className="w-12 h-12 bg-[#ff5412] hover:bg-[#ffaa3b] text-[#060505] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
                        aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
                      >
                        {player.isBuffering ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : player.isPlaying ? (
                          <Pause size={18} fill="currentColor" />
                        ) : (
                          <Play size={18} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={player.nextTrack}
                        disabled={!player.activeTrack}
                        className="w-11 h-11 border border-[rgba(244,239,230,0.2)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
                        aria-label="Siguiente"
                      >
                        <SkipForward size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Interactive Progress Rail */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#b3a89a] tnum w-10">
                      {formatSecondsToMMSS(player.currentTime)}
                    </span>
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label="Progreso de reproducción"
                      aria-valuemin={0}
                      aria-valuemax={Math.round(player.duration || 100)}
                      aria-valuenow={Math.round(player.currentTime)}
                      onClick={(e) => {
                        if (player.duration <= 0) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        player.seek(ratio * player.duration);
                      }}
                      className="flex-1 h-2 bg-[rgba(244,239,230,0.12)] cursor-pointer relative overflow-hidden group"
                    >
                      <div
                        className="h-full bg-[#ff5412] group-hover:bg-[#ffaa3b] transition-[width] duration-150"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-[#b3a89a] tnum w-10 text-right">
                      {player.duration > 0
                        ? formatSecondsToMMSS(player.duration)
                        : player.activeTrack?.duration || '0:00'}
                    </span>
                  </div>
                </div>

                {/* Numbered Tracklist */}
                {player.activeAlbum.tracks.length === 0 ? (
                  <div className="py-10 text-sm text-[#72675d]">
                    Este álbum aún no tiene pistas cargadas. Agrégalas en el módulo CMS.
                  </div>
                ) : (
                  <div className="divide-y divide-[rgba(244,239,230,0.1)] border-b border-[rgba(244,239,230,0.1)]">
                    {player.activeAlbum.tracks.map((track, idx) => {
                      const isCurrent = player.activeTrack?.id === track.id;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          onClick={() => player.playTrack(player.activeAlbum!, idx)}
                          className={`w-full text-left py-4 px-3 flex items-center justify-between gap-4 transition-colors cursor-pointer group ${
                            isCurrent
                              ? 'bg-[#ff5412]/10 text-[#f4efe6]'
                              : 'hover:bg-[rgba(244,239,230,0.035)] text-[#b3a89a] hover:text-[#f4efe6]'
                          }`}
                        >
                          <div className="flex items-center gap-5 min-w-0">
                            <span
                              className={`lion-display text-2xl w-8 shrink-0 ${
                                isCurrent ? 'text-[#ff5412]' : 'text-[#72675d] group-hover:text-[#ffaa3b]'
                              }`}
                            >
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0">
                              <div className="lion-label text-xs sm:text-sm truncate text-inherit">
                                {track.title}
                              </div>
                              {!track.audio_url && (
                                <div className="text-[11px] text-[#72675d]">Sin archivo de audio vinculado</div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            {isCurrent && player.isPlaying ? (
                              <EqBars active={true} className="text-[#ff5412]" />
                            ) : (
                              <Play
                                size={14}
                                className="opacity-0 group-hover:opacity-100 text-[#ff5412] transition-opacity"
                              />
                            )}
                            <span
                              className={`text-xs tnum ${
                                isCurrent ? 'text-[#ff5412] font-bold' : 'text-[#72675d]'
                              }`}
                            >
                              {track.duration || '0:00'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          4. VIDEOS Y SESIONES EN VIVO (Cinema Modal + Real Uploads / YouTube)
         ===================================================================== */}
      <section
        id="videos"
        className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#060505] border-b border-[rgba(244,239,230,0.14)]"
      >
        <div className="max-w-[1380px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[rgba(244,239,230,0.14)] mb-12">
            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-2">ARCHIVO AUDIOVISUAL · DIRECTOS</div>
              <h2 className="lion-display-l text-[#f4efe6]">VIDEOS Y SESIONES</h2>
            </div>
            <p className="lion-body max-w-md">
              Videoclips oficiales, sesiones en vivo y tomas en el cuarto de ensayo en máxima calidad.
            </p>
          </div>

          {!featuredVideo ? (
            <div className="py-14 border border-dashed border-[rgba(244,239,230,0.16)] px-6 text-center space-y-4">
              <Film size={36} className="mx-auto text-[#ff5412]/70" />
              <div className="lion-display text-2xl text-[#f4efe6]">SIN VIDEOS PUBLICADOS AÚN</div>
              <p className="lion-body text-sm max-w-md mx-auto">
                Sube archivos MP4/WebM o vincula videoclips de YouTube/Vimeo desde el módulo CMS.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Featured 16:9 Cinema Poster (jeremycamp.com vi-release__poster pattern) */}
              <button
                type="button"
                onClick={() => openVideoModal(featuredVideo)}
                className="relative w-full aspect-video max-h-[680px] bg-[#110e0c] border border-[rgba(255,84,18,0.3)] overflow-hidden group text-left block cursor-pointer shadow-[0_36px_80px_-32px_rgba(0,0,0,0.9)]"
              >
                <img
                  src={featuredVideo.thumbnail_url || getAutoVideoThumbnail(featuredVideo.video_url, heroImage)}
                  alt={featuredVideo.title}
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
                <div
                  className="absolute inset-0 transition-opacity duration-300"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(6,5,5,0.2) 0%, rgba(6,5,5,0.4) 55%, rgba(6,5,5,0.92) 100%)',
                  }}
                />
                <div className="absolute top-5 left-5 sm:top-8 sm:left-8 flex items-center gap-3">
                  <span className="lion-label text-xs px-3 py-1 bg-[#ff5412] text-[#060505]">
                    {featuredVideo.category || 'DESTACADO'}
                  </span>
                  {featuredVideo.duration && (
                    <span className="lion-label text-xs px-2.5 py-1 bg-[#060505]/75 text-[#f4efe6] tnum">
                      {featuredVideo.duration}
                    </span>
                  )}
                </div>

                {/* Centered Play Emblem */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full border-2 border-[#ff5412] bg-[#060505]/70 group-hover:bg-[#ff5412] text-[#f4efe6] group-hover:text-[#060505] flex items-center justify-center transition-all duration-200 group-hover:scale-105">
                    <Play size={30} fill="currentColor" className="ml-1" />
                  </div>
                </div>

                <div className="absolute bottom-5 inset-x-5 sm:bottom-8 sm:inset-x-8 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <div>
                    <h3 className="lion-display text-3xl sm:text-5xl text-[#f4efe6]">
                      {featuredVideo.title}
                    </h3>
                    {featuredVideo.description && (
                      <p className="text-sm text-[#d4cbc0] mt-1 max-w-2xl line-clamp-2">
                        {featuredVideo.description}
                      </p>
                    )}
                  </div>
                  <span className="lion-label text-xs text-[#ffaa3b] shrink-0">
                    VER EN PANTALLA COMPLETA →
                  </span>
                </div>
              </button>

              {/* Secondary Videos Strip */}
              {secondaryVideos.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {secondaryVideos.map((vid) => (
                    <button
                      key={vid.id}
                      type="button"
                      onClick={() => openVideoModal(vid)}
                      className="group text-left flex flex-col gap-3 cursor-pointer"
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-[#110e0c] border border-[rgba(244,239,230,0.12)] group-hover:border-[#ff5412] transition-colors">
                        <img
                          src={vid.thumbnail_url || getAutoVideoThumbnail(vid.video_url, heroImage)}
                          alt={vid.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/35 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                          <span className="w-12 h-12 rounded-full border border-[#f4efe6] bg-[#060505]/70 group-hover:bg-[#ff5412] group-hover:border-[#ff5412] text-[#f4efe6] group-hover:text-[#060505] flex items-center justify-center transition-colors">
                            <Play size={18} fill="currentColor" className="ml-0.5" />
                          </span>
                        </div>
                        {vid.duration && (
                          <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 bg-[#060505]/85 text-[#f4efe6] lion-label text-[11px] tnum">
                            {vid.duration}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="lion-label text-[11px] text-[#ff5412]">{vid.category}</div>
                        <h4 className="lion-display text-2xl text-[#f4efe6] group-hover:text-[#ffaa3b] transition-colors mt-0.5">
                          {vid.title}
                        </h4>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          5. GALERÍA FOTOGRÁFICA EDITORIAL + LIGHTBOX
         ===================================================================== */}
      <section
        id="fotos"
        className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#0b0908] border-b border-[rgba(244,239,230,0.14)]"
      >
        <div className="max-w-[1380px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[rgba(244,239,230,0.14)] mb-12">
            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-2">EN ESCENARIO · ESTUDIO · BACKSTAGE</div>
              <h2 className="lion-display-l text-[#f4efe6]">GALERÍA FOTOGRÁFICA</h2>
            </div>

            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photoCategories.map((cat) => {
                  const active = photoFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setPhotoFilter(cat)}
                      className={`px-3.5 py-2 lion-label text-xs transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#ff5412] text-[#060505]'
                          : 'border border-[rgba(244,239,230,0.18)] text-[#b3a89a] hover:text-[#f4efe6] hover:border-[#ff5412]'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {filteredPhotos.length === 0 ? (
            <div className="py-14 border border-dashed border-[rgba(244,239,230,0.16)] px-6 text-center space-y-4">
              <Camera size={36} className="mx-auto text-[#ff5412]/70" />
              <div className="lion-display text-2xl text-[#f4efe6]">GALERÍA LISTA PARA TUS FOTOS</div>
              <p className="lion-body text-sm max-w-md mx-auto">
                Carga fotos de conciertos, sesiones y backstage desde el módulo CMS y aparecerán aquí con visor de pantalla completa.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPhotos.map((photo, idx) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className={`group relative overflow-hidden bg-[#15110e] border border-[rgba(244,239,230,0.1)] hover:border-[#ff5412] transition-colors text-left cursor-pointer ${
                    idx === 0 && filteredPhotos.length >= 4 ? 'sm:col-span-2 aspect-[16/10]' : 'aspect-[4/3]'
                  }`}
                >
                  <img
                    src={photo.image_url}
                    alt={photo.title || 'Fotografía de La Nación del León'}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#060505]/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-250 flex flex-col justify-end p-5">
                    <span className="lion-label text-[11px] text-[#ff5412]">{photo.category}</span>
                    {photo.title && (
                      <span className="lion-display text-2xl text-[#f4efe6] mt-0.5">{photo.title}</span>
                    )}
                    {photo.caption && (
                      <span className="text-xs text-[#d4cbc0] mt-1 line-clamp-2">{photo.caption}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          6. FECHAS DE GIRA (TOUR DATES)
         ===================================================================== */}
      <section
        id="gira"
        className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#060505] border-b border-[rgba(244,239,230,0.14)]"
      >
        <div className="max-w-[1380px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[rgba(244,239,230,0.14)] mb-10">
            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-2">CONCIERTOS Y FESTIVALES</div>
              <h2 className="lion-display-l text-[#f4efe6]">EN LA RUTA</h2>
            </div>
            <a
              href={`mailto:${profile.booking_email}?subject=Booking%20La%20Naci%C3%B3n%20del%20Le%C3%B3n`}
              className="lion-label text-xs text-[#ffaa3b] hover:text-[#ff5412] inline-flex items-center gap-1.5"
            >
              <span>SOLICITAR FECHA / BOOKING</span>
              <ArrowUpRight size={15} />
            </a>
          </div>

          {events.length === 0 ? (
            <div className="py-12 border border-dashed border-[rgba(244,239,230,0.16)] px-6 text-center space-y-3">
              <Calendar size={32} className="mx-auto text-[#ff5412]/70" />
              <div className="lion-display text-2xl text-[#f4efe6]">PRÓXIMAS FECHAS POR ANUNCIAR</div>
              <p className="lion-body text-sm max-w-md mx-auto">
                Agrega conciertos desde el CMS para activar automáticamente el calendario, el ticker superior y la cuenta regresiva.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[rgba(244,239,230,0.12)] border-b border-[rgba(244,239,230,0.12)]">
              {events.map((ev) => {
                const dp = parseDateParts(ev.event_date);
                const isSoldOut = ev.status.toUpperCase().includes('AGOTADO');
                return (
                  <div
                    key={ev.id}
                    className="py-6 px-2 flex flex-col md:flex-row md:items-center justify-between gap-5 hover:bg-[rgba(255,84,18,0.04)] transition-colors"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-20 shrink-0 border-r border-[rgba(244,239,230,0.14)] pr-5 text-center">
                        <div className="lion-display text-4xl text-[#ff5412] leading-none">{dp.day}</div>
                        <div className="lion-label text-xs text-[#b3a89a] mt-1">
                          {dp.month} {dp.year}
                        </div>
                      </div>
                      <div>
                        <div className="lion-display text-2xl sm:text-3xl text-[#f4efe6]">{ev.venue}</div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-[#b3a89a]">
                          <span>{ev.city}</span>
                          <span className="text-[#72675d]">·</span>
                          <span className={`lion-label text-xs ${isSoldOut ? 'text-[#72675d]' : 'text-[#ffaa3b]'}`}>
                            {ev.status}
                          </span>
                          {ev.notes && <span className="text-xs text-[#72675d]">({ev.notes})</span>}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isSoldOut ? (
                        <span className="lion-label text-xs text-[#72675d] px-5 py-3 border border-[rgba(244,239,230,0.1)] inline-block">
                          AGOTADO
                        </span>
                      ) : ev.ticket_url ? (
                        <a
                          href={ev.ticket_url}
                          target="_blank"
                          rel="noreferrer"
                          className="lion-btn-wire lion-label text-xs"
                        >
                          <span>ENTRADAS</span>
                          <ArrowUpRight size={15} />
                        </a>
                      ) : (
                        <a
                          href={`mailto:${profile.booking_email}?subject=Entradas%20${encodeURIComponent(ev.city)}`}
                          className="lion-btn-wire lion-label text-xs"
                        >
                          <span>INFO SHOW</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
          7. LA BANDA & MANIFIESTO
         ===================================================================== */}
      <section
        id="banda"
        className="py-20 lg:py-28 px-5 sm:px-8 lg:px-12 bg-[#0b0908] border-b border-[rgba(244,239,230,0.14)]"
      >
        <div className="max-w-[1380px] mx-auto space-y-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-7">
              <div className="lion-label text-xs text-[#ff5412] mb-2">IDENTIDAD Y SONIDO</div>
              <h2 className="lion-display-l text-[#f4efe6]">{profile.manifesto_title}</h2>
            </div>
            <div className="lg:col-span-5">
              <p className="lion-lead">{profile.manifesto_body}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {profile.members.map((member, idx) => (
              <div
                key={member.id || idx}
                className={`pt-5 border-t-2 transition-colors ${
                  idx === 0
                    ? 'border-[#ff5412]'
                    : 'border-[rgba(244,239,230,0.18)] hover:border-[#ff5412]'
                }`}
              >
                <div className="lion-label text-xs text-[#ff5412]">{member.role}</div>
                <div className="lion-display text-3xl text-[#f4efe6] mt-1">{member.name}</div>
                <p className="text-sm text-[#b3a89a] mt-3 leading-relaxed">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =====================================================================
          8. BOOKING, NEWSLETTER & FOOTER
         ===================================================================== */}
      <footer id="contacto" className="py-20 px-5 sm:px-8 lg:px-12 bg-[#060505]">
        <div className="max-w-[1380px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pb-16 border-b border-[rgba(244,239,230,0.14)]">
            <div className="lg:col-span-6 space-y-3">
              <div className="lion-label text-xs text-[#ff5412]">COMUNIDAD OFICIAL</div>
              <h2 className="lion-display text-4xl sm:text-5xl text-[#f4efe6]">ÚNETE A LA MANADA</h2>
              <p className="lion-body max-w-md">
                Recibe estrenos antes que nadie, fechas secretas y accesos exclusivos a lanzamientos.
              </p>
            </div>
            <div className="lg:col-span-6 flex items-center">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newsletterEmail.trim()) return;
                  setNewsletterDone(true);
                  setNewsletterEmail('');
                }}
                className="w-full space-y-3"
              >
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    required
                    value={newsletterEmail}
                    onChange={(e) => {
                      setNewsletterEmail(e.target.value);
                      setNewsletterDone(false);
                    }}
                    placeholder="tu@correo.com"
                    className="flex-1 bg-[#0d0b0a] border border-[rgba(244,239,230,0.22)] focus:border-[#ff5412] px-4 py-3.5 text-sm text-[#f4efe6] outline-none transition-colors"
                  />
                  <button type="submit" className="lion-btn-ember lion-label text-xs shrink-0">
                    SUSCRIBIRSE
                  </button>
                </div>
                {newsletterDone && (
                  <p className="lion-label text-xs text-[#ffaa3b]">
                    ¡REGISTRADO! BIENVENIDO A LA NACIÓN DEL LEÓN.
                  </p>
                )}
              </form>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 py-14">
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-3">
                <LionCrestMark className="w-9 h-9" />
                <span className="lion-display text-2xl text-[#f4efe6]">{profile.band_name}</span>
              </div>
              <p className="text-sm text-[#72675d] leading-relaxed">
                Web oficial conectada en tiempo real a nuestro catálogo de estudio y plataforma de escenario.
              </p>
            </div>

            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-4">EXPLORAR</div>
              <ul className="space-y-2.5 text-sm text-[#b3a89a]">
                {navItems.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className="hover:text-[#f4efe6] transition-colors">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-4">ESCUCHAR &amp; SEGUIR</div>
              <ul className="space-y-2.5 text-sm text-[#b3a89a]">
                {profile.spotify_url && (
                  <li>
                    <a href={profile.spotify_url} target="_blank" rel="noreferrer" className="hover:text-[#f4efe6] inline-flex items-center gap-1">
                      Spotify <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.apple_music_url && (
                  <li>
                    <a href={profile.apple_music_url} target="_blank" rel="noreferrer" className="hover:text-[#f4efe6] inline-flex items-center gap-1">
                      Apple Music <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.youtube_url && (
                  <li>
                    <a href={profile.youtube_url} target="_blank" rel="noreferrer" className="hover:text-[#f4efe6] inline-flex items-center gap-1">
                      YouTube <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.instagram_url && (
                  <li>
                    <a href={profile.instagram_url} target="_blank" rel="noreferrer" className="hover:text-[#f4efe6] inline-flex items-center gap-1">
                      Instagram <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {profile.tiktok_url && (
                  <li>
                    <a href={profile.tiktok_url} target="_blank" rel="noreferrer" className="hover:text-[#f4efe6] inline-flex items-center gap-1">
                      TikTok <ArrowUpRight size={13} />
                    </a>
                  </li>
                )}
                {!profile.spotify_url &&
                  !profile.apple_music_url &&
                  !profile.youtube_url &&
                  !profile.instagram_url &&
                  !profile.tiktok_url && (
                    <li className="text-[#72675d] text-xs">
                      Configura tus enlaces oficiales en el módulo CMS.
                    </li>
                  )}
              </ul>
            </div>

            <div>
              <div className="lion-label text-xs text-[#ff5412] mb-4">BOOKING &amp; GESTIÓN</div>
              <a
                href={`mailto:${profile.booking_email}`}
                className="inline-flex items-center gap-2 text-sm text-[#f4efe6] hover:text-[#ff5412] transition-colors break-all"
              >
                <Mail size={15} className="shrink-0 text-[#ff5412]" />
                <span>{profile.booking_email}</span>
              </a>
              <div className="mt-5">
                <Link
                  to={session ? '/nacion-cms' : '/login'}
                  className="lion-label text-xs text-[#b3a89a] hover:text-[#ff5412] inline-flex items-center gap-1.5"
                >
                  <Settings2 size={14} />
                  <span>PANEL DE CONTENIDO CMS</span>
                </Link>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-[rgba(244,239,230,0.1)] flex flex-wrap items-center justify-between gap-4 text-xs text-[#72675d]">
            <span>
              {profile.band_name.toUpperCase()} © {new Date().getFullYear()} · TODOS LOS DERECHOS RESERVADOS
            </span>
            <a
              href="#top"
              className="lion-label text-xs text-[#f4efe6] hover:text-[#ff5412] inline-flex items-center gap-1.5 transition-colors"
            >
              <span>VOLVER ARRIBA</span>
              <ArrowUp size={14} />
            </a>
          </div>
        </div>
      </footer>

      {/* =====================================================================
          PERSISTENT FLOATING MINI-PLAYER (When scrolling past Hero with audio)
         ===================================================================== */}
      <AnimatePresence>
        {showFloatingPlayer && player.activeTrack && (player.isPlaying || player.currentTime > 0) && (
          <motion.div
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={SPRING_UI}
            className="fixed bottom-0 inset-x-0 z-40 bg-[#0d0b0a]/96 backdrop-blur-xl border-t border-[#ff5412]/50 px-4 sm:px-8 py-3 shadow-[0_-16px_40px_rgba(0,0,0,0.85)]"
          >
            <div className="max-w-[1380px] mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={player.activeAlbum?.cover_url || DEFAULT_ALBUM_COVER}
                  alt={player.activeAlbum?.title || ''}
                  className="w-11 h-11 object-cover border border-[rgba(255,84,18,0.4)] shrink-0"
                />
                <div className="min-w-0">
                  <div className="lion-display text-lg text-[#f4efe6] truncate">
                    {player.activeTrack.title}
                  </div>
                  <div className="lion-label text-[11px] text-[#ff5412] truncate">
                    {player.activeAlbum?.title}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={player.prevTrack}
                  className="text-[#b3a89a] hover:text-[#f4efe6] p-1.5 cursor-pointer"
                  aria-label="Anterior"
                >
                  <SkipBack size={16} />
                </button>
                <button
                  type="button"
                  onClick={player.togglePlay}
                  className="w-10 h-10 bg-[#ff5412] hover:bg-[#ffaa3b] text-[#060505] flex items-center justify-center cursor-pointer"
                  aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
                >
                  {player.isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={player.nextTrack}
                  className="text-[#b3a89a] hover:text-[#f4efe6] p-1.5 cursor-pointer"
                  aria-label="Siguiente"
                >
                  <SkipForward size={16} />
                </button>
              </div>

              <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
                <span className="text-xs text-[#b3a89a] tnum w-10 text-right">
                  {formatSecondsToMMSS(player.currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(player.duration, 1)}
                  step={0.5}
                  value={Math.min(player.currentTime, Math.max(player.duration, 1))}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  className="lion-scrubber flex-1"
                  aria-label="Barra de progreso"
                />
                <span className="text-xs text-[#b3a89a] tnum w-10">
                  {player.duration > 0 ? formatSecondsToMMSS(player.duration) : player.activeTrack.duration}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          CINEMA VIDEO MODAL (Supports uploaded MP4/WebM + YouTube + Vimeo)
         ===================================================================== */}
      <AnimatePresence>
        {selectedVideoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelectedVideoModal(null)}
            className="fixed inset-0 z-[80] bg-[#060505]/96 backdrop-blur-xl flex items-center justify-center p-4 sm:p-8"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={SPRING_UI}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl space-y-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="lion-label text-xs text-[#ff5412]">{selectedVideoModal.category}</span>
                  <h3 className="lion-display text-2xl sm:text-4xl text-[#f4efe6]">
                    {selectedVideoModal.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedVideoModal(null)}
                  className="w-11 h-11 border border-[rgba(244,239,230,0.22)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center cursor-pointer shrink-0"
                  aria-label="Cerrar video"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="aspect-video w-full bg-black border border-[rgba(255,84,18,0.35)] overflow-hidden">
                {getEmbedVideoUrl(selectedVideoModal) ? (
                  <iframe
                    src={getEmbedVideoUrl(selectedVideoModal)!}
                    title={selectedVideoModal.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                ) : (
                  <video
                    src={selectedVideoModal.video_url}
                    poster={selectedVideoModal.thumbnail_url || undefined}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              {selectedVideoModal.description && (
                <p className="text-sm text-[#b3a89a] max-w-3xl">{selectedVideoModal.description}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          FULLSCREEN PHOTO LIGHTBOX
         ===================================================================== */}
      <AnimatePresence>
        {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setLightboxIndex(null)}
            className="fixed inset-0 z-[80] bg-[#060505]/96 backdrop-blur-xl flex flex-col justify-between p-4 sm:p-8"
          >
            <div className="flex items-center justify-between gap-4 max-w-6xl w-full mx-auto">
              <span className="lion-label text-xs text-[#ff5412] tnum">
                {String(lightboxIndex + 1).padStart(2, '0')} / {String(filteredPhotos.length).padStart(2, '0')} ·{' '}
                {filteredPhotos[lightboxIndex].category}
              </span>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="w-11 h-11 border border-[rgba(244,239,230,0.22)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center cursor-pointer"
                aria-label="Cerrar visor"
              >
                <X size={20} />
              </button>
            </div>

            <div
              className="relative flex-1 flex items-center justify-center my-4 max-w-6xl w-full mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {filteredPhotos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIndex((prev) =>
                      prev === null ? 0 : (prev - 1 + filteredPhotos.length) % filteredPhotos.length
                    )
                  }
                  className="absolute left-0 sm:left-2 z-10 w-12 h-12 bg-[#060505]/80 border border-[rgba(244,239,230,0.22)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center cursor-pointer"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft size={22} />
                </button>
              )}

              <motion.img
                key={filteredPhotos[lightboxIndex].id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, ease: EASE_EDITORIAL }}
                src={filteredPhotos[lightboxIndex].image_url}
                alt={filteredPhotos[lightboxIndex].title || ''}
                className="max-h-[74vh] max-w-full object-contain border border-[rgba(244,239,230,0.14)]"
              />

              {filteredPhotos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % filteredPhotos.length))
                  }
                  className="absolute right-0 sm:right-2 z-10 w-12 h-12 bg-[#060505]/80 border border-[rgba(244,239,230,0.22)] hover:border-[#ff5412] text-[#f4efe6] flex items-center justify-center cursor-pointer"
                  aria-label="Siguiente foto"
                >
                  <ChevronRight size={22} />
                </button>
              )}
            </div>

            <div className="max-w-6xl w-full mx-auto text-center space-y-1">
              {filteredPhotos[lightboxIndex].title && (
                <div className="lion-display text-2xl text-[#f4efe6]">
                  {filteredPhotos[lightboxIndex].title}
                </div>
              )}
              {filteredPhotos[lightboxIndex].caption && (
                <p className="text-sm text-[#b3a89a]">{filteredPhotos[lightboxIndex].caption}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
